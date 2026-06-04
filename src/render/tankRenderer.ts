import { ColorMatrixFilter, Container, Graphics } from "pixi.js";
import type { SimState } from "../sim/types";
import type { PopulationEntry } from "../sim/species";
import type { TankState } from "../sim/tankgen";
import { computeLayout } from "./layout";
import { buildBackdrop } from "./layers/backdrop";
import { buildCreatures } from "./layers/creatures";
import { buildFlora } from "./layers/flora";
import { buildGlass } from "./layers/glass";
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
  /** redraw growth + population visuals — call on sim updates */
  update(sim: SimState, population: readonly PopulationEntry[]): void;
  /** ambient motion frame — call ONLY from the visible-gated slow ticker */
  tick(timeMs: number): void;
  destroy(): void;
}

/**
 * Assembles the layered side-view tank (docs/ARCHITECTURE.md layer order)
 * and applies the single warm-grade ColorMatrixFilter at the root.
 * The view is a pure READER of sim state — it never mutates it.
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

  // the slow indigo of night, laid over the whole scene
  const night = new Graphics();
  night.rect(0, 0, viewWidth, viewHeight).fill(NIGHT_COLOR);
  night.alpha = 0;

  root.addChild(
    buildBackdrop(viewWidth, viewHeight, layout),
    water.behind,
    buildSubstrate(tank, layout),
    flora.container,
    creatures.container,
    water.overlay,
    buildGlass(layout),
    night,
  );

  const grade = new ColorMatrixFilter();
  // gentle amber lift: warm highlights, slightly tucked blues — no blowout
  grade.matrix = [
    1.05, 0, 0, 0, 0.012,
    0, 1.0, 0, 0, 0.006,
    0, 0, 0.94, 0, 0,
    0, 0, 0, 1, 0,
  ];
  root.filters = [grade];

  stage.addChild(root);

  return {
    update(sim: SimState, population: readonly PopulationEntry[]): void {
      flora.update(sim);
      creatures.update(population);
      night.alpha = NIGHT_MAX_ALPHA * nightStrength(sim.simTimeMs);
    },
    tick(timeMs: number): void {
      flora.tick(timeMs);
      creatures.tick(timeMs);
      water.ripple(timeMs / 700);
    },
    destroy(): void {
      root.destroy({ children: true });
    },
  };
}
