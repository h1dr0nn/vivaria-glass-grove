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

  const regions = waterRuns(tank);

  // The water BODY and its tint are retraced every tick with their top edge
  // following the LIVE surface curve — a static flat top would peek out (or
  // leave a gap) whenever a strong slosh tilts the surface past it.
  const body = new Graphics();
  behind.addChild(body);
  const bodyGradient = new FillGradient({
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
  const tint = new Graphics();
  overlay.addChild(tint);

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

  /** trace a run: live top edge → down the bank → back along the floor */
  const traceWithTop = (
    g: Graphics,
    run: WaterRun,
    topY: (x: number) => number,
  ): void => {
    g.moveTo(screenX(layout, run.start), topY(run.start));
    for (let x = run.start + 2; x <= run.end + 1; x += 2) {
      const cx = Math.min(x, run.end);
      g.lineTo(screenX(layout, cx), topY(cx));
    }
    for (let x = run.end - 1; x >= run.start; x--) {
      const floor = screenY(layout, tank.terrainHeight[x]);
      g.lineTo(screenX(layout, x + 1), floor);
      g.lineTo(screenX(layout, x), floor);
    }
    g.closePath();
  };

  const ripple = (phase: number, slosh?: SloshReading): void => {
    surfaceBand.clear();
    surfaceLine.clear();
    body.clear();
    tint.clear();
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

    // body + tint first — the surface assembly draws over their top edge
    for (const run of regions) {
      traceWithTop(body, run, frontY);
      body.fill(bodyGradient);
      traceWithTop(tint, run, frontY);
      tint.fill({ color: SCENE.waterTintOverlay, alpha: 0.22 });
    }

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

    // Shore fringe. The water's edge against the bank is the SEGMENT from
    // the near-line contact P0 to the far-line contact P1 (P0 + depth
    // vector). Five quiet layers, back-to-front, all phase-driven (research:
    // softness comes from stacked translucent fills + uneven rhythm, never
    // from more bubbles): wet lip → foam ribbons → scalloped rim → periodic
    // lap waves → meniscus. Slosh churn AMPLIFIES, it never adds shapes.
    const churn = 1 + (slosh?.wave ?? 0) * 2.2;
    const s = layout.scale;
    const foam = (boundary: number, into: 1 | -1): void => {
      const x0 = screenX(layout, boundary);
      const y0 = frontY(boundary);
      const ax = layout.depthX;
      const ay = backY(boundary) - y0;
      const len = Math.hypot(ax, ay) || 1;
      // unit normal of the contact segment, pointing into the water
      let nx = -ay / len;
      let ny = ax / len;
      if (Math.sign(nx || 1) !== Math.sign(into)) {
        nx = -nx;
        ny = -ny;
      }
      const at = (t: number, d: number): [number, number] => [
        x0 + ax * t + nx * d,
        y0 + ay * t + ny * d,
      ];

      // 1 — wet lip grounding the seam on the bank side
      const lip: number[] = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        lip.push(...at(t, -0.05 * s));
      }
      for (let i = 4; i >= 0; i--) {
        const t = i / 4;
        lip.push(...at(t, -0.55 * s));
      }
      surfaceLine.poly(lip).fill({ color: SCENE.sandWet, alpha: 0.4 });

      // 2 — translucent ribbons feathering into the water, whitest at shore
      const RIBBONS = [
        { d: 0.18, half: 0.28, color: 0xf7fbf9, alpha: 0.5 },
        { d: 0.75, half: 0.22, color: 0xe8f4f0, alpha: 0.3 },
        { d: 1.35, half: 0.18, color: 0xcfe6e6, alpha: 0.17 },
      ];
      for (const [ri, r] of RIBBONS.entries()) {
        const top: number[] = [];
        const bottom: number[] = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const wob =
            Math.sin(phase * 0.8 + t * 6 + ri * 2.1 + boundary) * 0.12 * s;
          const taper =
            Math.sin(Math.PI * (0.08 + 0.84 * t)) ** 0.7 * r.half * s;
          const [sx, sy] = at(t, r.d * s + wob);
          top.push(sx + nx * taper, sy + ny * taper);
          bottom.unshift(sx - nx * taper, sy - ny * taper);
        }
        surfaceLine
          .poly([...top, ...bottom])
          .fill({ color: r.color, alpha: Math.min(0.65, r.alpha * churn) });
      }

      // 3 — scalloped foam rim: uneven crests, fat near P0, thin toward P1,
      // phase-scrolled so the fringe shimmers like a travelling lap
      const rim: number[] = [];
      const SAMPLES = 12;
      for (let i = 0; i <= SAMPLES; i++) {
        const t = i / SAMPLES;
        const jitter =
          0.65 +
          0.25 * Math.sin(t * 9 + phase * 0.65 + boundary * 1.3) +
          0.15 * Math.sin(t * 17 - phase * 0.4 + boundary);
        const bump =
          Math.max(0, (0.34 - 0.15 * t) * jitter) *
          s *
          Math.min(churn, 1.8);
        rim.push(...at(t, 0.06 * s + bump));
      }
      for (let i = SAMPLES; i >= 0; i--) {
        rim.push(...at(i / SAMPLES, 0));
      }
      surfaceLine.poly(rim).fill({ color: 0xf2faf6, alpha: 0.55 });

      // 4 — periodic lap waves: born at the seam, drift out, ease-out fade
      for (const offset of [0, 0.5]) {
        const u = (phase / 3.7 + offset + boundary * 0.13) % 1;
        const fade = (1 - u) * (1 - u) * 0.4 * Math.min(churn, 1.6);
        if (fade < 0.04) continue;
        const reach = (0.4 + u * 2.8) * s;
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const wob = Math.sin(t * 7 + phase * 0.9 + boundary) * 0.15 * s;
          const [lx, ly] = at(t, reach + wob);
          if (i === 0) surfaceLine.moveTo(lx, ly);
          else surfaceLine.lineTo(lx, ly);
        }
        surfaceLine.stroke({
          color: SCENE.surfaceLine,
          alpha: fade,
          width: Math.max(0.8, (1 - u) * 0.28 * s),
        });
      }

      // 5 — meniscus: a tiny bright stitch where the flat line meets the bank
      const [mx, my] = at(0.05, 0.02 * s);
      surfaceLine.circle(mx, my, 0.16 * s).fill({ color: 0xffffff, alpha: 0.7 });
    };
    for (const run of bandRuns) {
      if (run.start > 0) foam(run.start, 1); // land on the left
      if (run.end < width) foam(run.end, -1); // land on the right
    }
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

