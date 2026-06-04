import { ColorMatrixFilter, Container } from "pixi.js";
import type { SimState } from "../sim/types";
import type { TankState } from "../sim/tankgen";
import { computeLayout } from "./layout";
import { buildBackdrop } from "./layers/backdrop";
import { buildFlora } from "./layers/flora";
import { buildGlass } from "./layers/glass";
import { buildSubstrate } from "./layers/substrate";
import { buildWater } from "./layers/water";

export interface TankView {
  /** redraw growth visuals from sim state — call on sim updates */
  update(sim: SimState): void;
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

  root.addChild(
    buildBackdrop(viewWidth, viewHeight, layout),
    water.behind,
    buildSubstrate(tank, layout),
    flora.container,
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
    update(sim: SimState): void {
      flora.update(sim);
    },
    tick(timeMs: number): void {
      flora.tick(timeMs);
      water.ripple(timeMs / 700);
    },
    destroy(): void {
      root.destroy({ children: true });
    },
  };
}
