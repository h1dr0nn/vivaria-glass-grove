import { ColorMatrixFilter, Container, Graphics } from "pixi.js";
import type { SimState } from "../sim/types";
import type { PopulationEntry } from "../sim/species";
import type { TankState } from "../sim/tankgen";
import { createSlosh } from "./slosh";
import { computeLayout } from "./layout";
import { buildBackdrop } from "./layers/backdrop";
import { buildCreatures } from "./layers/creatures";
import { buildFlora } from "./layers/flora";
import { buildGlass, glassFrame } from "./layers/glass";
import { buildSubstrate } from "./layers/substrate";
import { buildWater } from "./layers/water";

const HOUR_MS = 3_600_000;
/** worlds begin in the morning light */
const DAY_START_OFFSET_HOURS = 9;
const NIGHT_COLOR = 0x1e2c45;
const NIGHT_MAX_ALPHA = 0.3;

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** 0 at midday, 1 deep at night, soft dusk/dawn ramps. */
function nightStrength(simTimeMs: number): number {
  const hour = (simTimeMs / HOUR_MS + DAY_START_OFFSET_HOURS) % 24;
  if (hour >= 7 && hour < 18) return 0;
  if (hour >= 18 && hour < 22) return smooth01((hour - 18) / 4);
  if (hour >= 22 || hour < 4) return 1;
  return 1 - smooth01((hour - 4) / 3);
}

export interface TankView {
  /** redraw growth + population visuals - call on sim updates */
  update(sim: SimState, population: readonly PopulationEntry[]): void;
  /** water/flora ambience - call from the visible-gated 80ms ticker */
  tickAmbient(timeMs: number): void;
  /** creature transforms - call from the visible-gated 60fps rAF loop */
  tickCreatures(timeMs: number): void;
  /** window drag kicked the tank - purely cosmetic */
  applyWindowImpulse(ax: number, ay: number): void;
  /** true while the water is still ringing from an impulse */
  isSloshing(): boolean;
  destroy(): void;
}

/**
 * Assembles the layered side-view tank (docs/ARCHITECTURE.md layer order)
 * and applies the single warm-grade ColorMatrixFilter at the root.
 * The view is a pure READER of sim state - it never mutates it.
 */
export function buildTankView(
  stage: Container,
  tank: TankState,
  viewWidth: number,
  viewHeight: number,
): TankView {
  const layout = computeLayout(viewWidth, viewHeight, tank);
  const root = new Container();

  const water = buildWater(tank, layout);
  const flora = buildFlora(tank, layout);
  const creatures = buildCreatures(tank, layout);
  const glass = buildGlass(layout);

  // everything INSIDE the tank clips to the rounded glass interior -
  // square substrate cells must never poke past the rounded corners
  const frame = glassFrame(layout);
  const contents = new Container();
  contents.addChild(
    water.behind,
    buildSubstrate(tank, layout),
    flora.container,
    creatures.container,
    water.overlay,
  );
  const contentsMask = new Graphics()
    .roundRect(frame.x, frame.y, frame.w, frame.h, frame.radius)
    .fill(0xffffff);
  contents.mask = contentsMask;

  // the slow indigo of night, laid over the whole scene
  const night = new Graphics();
  night.rect(0, 0, viewWidth, viewHeight).fill(NIGHT_COLOR);
  night.alpha = 0;

  root.addChild(
    buildBackdrop(viewWidth, viewHeight, layout),
    glass.back,
    contents,
    contentsMask,
    glass.front,
    night,
  );

  const grade = new ColorMatrixFilter();
  // gentle amber lift: warm highlights, slightly tucked blues - no blowout
  grade.matrix = [
    1.05, 0, 0, 0, 0.012,
    0, 1.0, 0, 0, 0.006,
    0, 0, 0.94, 0, 0,
    0, 0, 0, 1, 0,
  ];
  root.filters = [grade];

  stage.addChild(root);

  const slosh = createSlosh();
  let lastAmbientMs = 0;

  return {
    update(sim: SimState, population: readonly PopulationEntry[]): void {
      flora.update(sim);
      creatures.update(population);
      night.alpha = NIGHT_MAX_ALPHA * nightStrength(sim.simTimeMs);
    },
    tickAmbient(timeMs: number): void {
      const dt =
        lastAmbientMs === 0
          ? 0.08
          : Math.min(0.25, (timeMs - lastAmbientMs) / 1000);
      lastAmbientMs = timeMs;
      slosh.step(dt);
      flora.tick(timeMs);
      water.ripple(timeMs / 700, slosh.read());
    },
    tickCreatures(timeMs: number): void {
      creatures.tick(timeMs);
    },
    applyWindowImpulse(ax: number, ay: number): void {
      slosh.impulse(ax, ay);
    },
    isSloshing(): boolean {
      return slosh.isAwake();
    },
    destroy(): void {
      root.destroy({ children: true });
    },
  };
}
