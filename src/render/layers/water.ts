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

    // the water-surface TOP FACE — the oblique band that says
    // "you are looking slightly down onto open water". Only REAL open
    // water gets one; noise puddles hiding behind the bank crest would
    // otherwise paint floating pale boxes on the land.
    const surfaceBand = new Graphics();
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
    const isOpenWater = (run: WaterRun): boolean => {
      if (run.end - run.start < 5) return false;
      let deepest = Number.POSITIVE_INFINITY;
      for (let x = run.start; x < run.end; x++) {
        deepest = Math.min(deepest, tank.terrainHeight[x]);
      }
      return deepest <= waterlineY - 2;
    };
    for (const run of regions.filter(isOpenWater)) {
      const top = screenY(layout, waterlineY);
      const x0 = screenX(layout, run.start);
      const x1 = screenX(layout, run.end);
      // skew only where the run meets the glass — where it meets the bank
      // the surface slips BEHIND the land, so that edge cuts straight up
      const leftSkew = run.start === 0 ? layout.depthX : 0;
      const rightSkew = run.end === width ? layout.depthX : 0;
      surfaceBand
        .poly([
          x0, top,
          x1, top,
          x1 + rightSkew, top + layout.depthY,
          x0 + leftSkew, top + layout.depthY,
        ])
        .fill(bandGradient);
      // specular streak along the far edge
      surfaceBand
        .moveTo(x0 + leftSkew, top + layout.depthY)
        .lineTo(x1 + rightSkew, top + layout.depthY)
        .stroke({
          color: SCENE.surfaceLine,
          alpha: 0.5,
          width: Math.max(1, layout.scale * 0.2),
        });
    }
    behind.addChild(surfaceBand);

    const tint = new Graphics();
    for (const run of regions) {
      tracePolygon(tint, tank, layout, run);
      tint.fill({ color: SCENE.waterTintOverlay, alpha: 0.22 });
    }
    overlay.addChild(tint);
  }

  const surfaceLine = new Graphics();
  overlay.addChild(surfaceLine);

  const ripple = (phase: number, slosh?: SloshReading): void => {
    surfaceLine.clear();
    if (waterlineY <= 0) return;
    const baseY = screenY(layout, waterlineY);
    // slosh: the surface leans, the wave swells and sweeps with the motion
    const tiltSpan = slosh ? Math.tan(slosh.tilt) * layout.tankWidthPx : 0;
    const amplitude =
      layout.scale * 0.22 + (slosh?.wave ?? 0) * layout.scale * 0.9;
    const phaseShift = slosh
      ? -slosh.waveDirection * slosh.wave * 2.5
      : 0;
    const bob = (slosh?.bob ?? 0) * layout.scale * 0.45;
    // draw only across open water — never through the emergent bank
    let penDown = false;
    for (let x = 0; x <= width; x += 2) {
      const column = Math.min(width - 1, x);
      const isWater = tank.terrainHeight[column] < waterlineY;
      if (!isWater) {
        penDown = false;
        continue;
      }
      const lean = (x / width - 0.5) * tiltSpan;
      const y =
        baseY + lean + bob + Math.sin(phase + phaseShift + x * 0.22) * amplitude;
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
