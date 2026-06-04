import { ColorMatrixFilter, Container } from "pixi.js";
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

  root.addChild(
    buildBackdrop(viewWidth, viewHeight, layout),
    water.behind,
    buildSubstrate(tank, layout),
    flora.container,
    creatures.container,
    water.overlay,
    buildGlass(layout),
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
