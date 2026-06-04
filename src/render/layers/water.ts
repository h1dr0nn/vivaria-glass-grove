import { Container, FillGradient, Graphics } from "pixi.js";
import type { TankState } from "../../sim/tankgen";
import type { SloshReading } from "../slosh";
import { SCENE } from "../palette";
import { screenX, screenY, type TankLayout } from "../layout";

export interface WaterLayer {
  readonly behind: Container;
  readonly overlay: Container;
  /** redraw the animated surface line at a given phase (+ optional slosh) */
  ripple(phase: number, slosh?: SloshReading): void;
}

/**
 * Water in two passes: a depth-gradient body BEHIND the substrate and a
 * translucent tint OVER it. Both are drawn as polygons that hug the actual
 * water region (surface line down to the basin floor), so emergent land is
 * never tinted.
 */
export function buildWater(tank: TankState, layout: TankLayout): WaterLayer {
  const behind = new Container();
  const overlay = new Container();
  const { waterlineY, width } = tank;

  if (waterlineY > 0) {
    const regions = waterRuns(tank);

    const body = new Graphics();
    const gradient = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: SCENE.waterSurface },
        { offset: 0.4, color: SCENE.waterShallow },
        { offset: 1, color: SCENE.waterDeep },
      ],
      textureSpace: "local",
    });
    for (const run of regions) {
      tracePolygon(body, tank, layout, run);
      body.fill(gradient);
    }
    behind.addChild(body);

    const tint = new Graphics();
    for (const run of regions) {
      tracePolygon(tint, tank, layout, run);
      tint.fill({ color: SCENE.waterTintOverlay, alpha: 0.22 });
    }
    overlay.addChild(tint);
  }

  // The whole visible surface — oblique top band, far specular, near line —
  // is ONE living assembly, redrawn together every ambient tick: it breathes
  // gently at rest and tilts/swells as a unit when the window is dragged.
  const surfaceBand = new Graphics();
  behind.addChild(surfaceBand); // under the substrate: shores occlude it
  const surfaceLine = new Graphics();
  overlay.addChild(surfaceLine);

  const bandGradient = new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: 0xbfe0e4 },
      { offset: 1, color: SCENE.waterSurface },
    ],
    textureSpace: "local",
  });

  // only REAL open water gets a top band (never noise puddles)
  const bandRuns = waterRuns(tank).filter((run) => {
    if (run.end - run.start < 5) return false;
    let deepest = Number.POSITIVE_INFINITY;
    for (let x = run.start; x < run.end; x++) {
      deepest = Math.min(deepest, tank.terrainHeight[x]);
    }
    return deepest <= waterlineY - 2;
  });

  const ripple = (phase: number, slosh?: SloshReading): void => {
    surfaceBand.clear();
    surfaceLine.clear();
    if (waterlineY <= 0) return;
    const baseY = screenY(layout, waterlineY);
    const tiltSpan = slosh ? Math.tan(slosh.tilt) * layout.tankWidthPx : 0;
    const amplitude =
      layout.scale * 0.3 + (slosh?.wave ?? 0) * layout.scale * 0.9;
    const phaseShift = slosh ? -slosh.waveDirection * slosh.wave * 2.5 : 0;
    // at rest the water still breathes — a slow, visible rise and fall
    const breath = Math.sin(phase * 0.45) * layout.scale * 0.15;
    const bob = (slosh?.bob ?? 0) * layout.scale * 0.45 + breath;

    const frontY = (x: number): number =>
      baseY +
      (x / width - 0.5) * tiltSpan +
      bob +
      Math.sin(phase + phaseShift + x * 0.22) * amplitude;
    // the far edge lags slightly behind — cheap parallax, but it must
    // move JUST as visibly as the near edge (sub-pixel sway reads as frozen)
    const backY = (x: number): number =>
      baseY +
      (x / width - 0.5) * tiltSpan * 0.8 +
      bob * 0.85 +
      Math.sin(phase + phaseShift + x * 0.22 + 0.9) * amplitude * 0.8 +
      layout.depthY;

    for (const run of bandRuns) {
      const front: number[] = [];
      const back: number[] = [];
      for (let x = run.start; x <= run.end; x += 2) {
        const cx = Math.min(x, run.end);
        front.push(screenX(layout, cx), frontY(cx));
      }
      for (let x = run.end; x >= run.start; x -= 2) {
        const cx = Math.max(x, run.start);
        back.push(screenX(layout, cx) + layout.depthX, backY(cx));
      }
      surfaceBand.poly([...front, ...back]).fill(bandGradient);
      // specular streak rides the far edge
      for (let i = back.length - 2; i >= 0; i -= 2) {
        if (i === back.length - 2) {
          surfaceBand.moveTo(back[i], back[i + 1]);
        } else {
          surfaceBand.lineTo(back[i], back[i + 1]);
        }
      }
      surfaceBand.stroke({
        color: SCENE.surfaceLine,
        alpha: 0.5,
        width: Math.max(1, layout.scale * 0.2),
      });
    }

    // near waterline — drawn over the tint, across ALL water columns
    let penDown = false;
    for (let x = 0; x <= width; x += 2) {
      const column = Math.min(width - 1, x);
      const isWater = tank.terrainHeight[column] < waterlineY;
      if (!isWater) {
        penDown = false;
        continue;
      }
      const y = frontY(x);
      if (!penDown) {
        surfaceLine.moveTo(screenX(layout, x), y);
        penDown = true;
      } else {
        surfaceLine.lineTo(screenX(layout, x), y);
      }
    }
    surfaceLine.stroke({
      color: SCENE.surfaceLine,
      alpha: 0.7,
      width: Math.max(1, layout.scale * 0.35),
    });
  };
  ripple(0);

  return { behind, overlay, ripple };
}

interface WaterRun {
  readonly start: number;
  /** exclusive */
  readonly end: number;
}

/** Maximal runs of contiguous water columns (terrain below the waterline). */
function waterRuns(tank: TankState): WaterRun[] {
  const runs: WaterRun[] = [];
  let start = -1;
  for (let x = 0; x <= tank.width; x++) {
    const isWater =
      x < tank.width && tank.terrainHeight[x] < tank.waterlineY;
    if (isWater && start < 0) start = x;
    if (!isWater && start >= 0) {
      runs.push({ start, end: x });
      start = -1;
    }
  }
  return runs;
}

/** Surface edge across the run, then back along the stepped terrain floor. */
function tracePolygon(
  g: Graphics,
  tank: TankState,
  layout: TankLayout,
  run: WaterRun,
): void {
  const top = screenY(layout, tank.waterlineY);
  g.moveTo(screenX(layout, run.start), top);
  g.lineTo(screenX(layout, run.end), top);
  for (let x = run.end - 1; x >= run.start; x--) {
    const floor = screenY(layout, tank.terrainHeight[x]);
    g.lineTo(screenX(layout, x + 1), floor);
    g.lineTo(screenX(layout, x), floor);
  }
  g.closePath();
}
