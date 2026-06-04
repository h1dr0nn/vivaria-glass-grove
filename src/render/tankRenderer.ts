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

/**
 * Time-of-day LIGHT TEMPERATURE — never a darkening overlay (user feedback:
 * dark patches feel unpleasant). The single warm-grade ColorMatrixFilter is
 * driven through gentle keyframes: noon neutral-warm, dusk amber, night a
 * soft moonlit cool (hue shift only), dawn faintly pink.
 * Each frame: [rGain, gGain, bGain, rOffset, bOffset].
 */
type GradeFrame = readonly [number, number, number, number, number];

const GRADE_NOON: GradeFrame = [1.05, 1.0, 0.94, 0.012, 0];
const GRADE_DUSK: GradeFrame = [1.12, 0.97, 0.86, 0.028, -0.008];
const GRADE_NIGHT: GradeFrame = [0.94, 0.98, 1.08, -0.004, 0.022];
const GRADE_DAWN: GradeFrame = [1.08, 0.98, 0.95, 0.02, 0.004];

/** keyframes around the 24h wheel (hour, frame) — lerped piecewise */
const GRADE_KEYS: ReadonlyArray<readonly [number, GradeFrame]> = [
  [5, GRADE_DAWN],
  [11, GRADE_NOON],
  [17, GRADE_NOON],
  [20.5, GRADE_DUSK],
  [23.5, GRADE_NIGHT],
  [29, GRADE_DAWN], // wraps to 5 next day
];

function gradeForTime(simTimeMs: number): GradeFrame {
  let hour = (simTimeMs / HOUR_MS + DAY_START_OFFSET_HOURS) % 24;
  if (hour < GRADE_KEYS[0][0]) hour += 24;
  for (let i = 0; i < GRADE_KEYS.length - 1; i++) {
    const [h0, f0] = GRADE_KEYS[i];
    const [h1, f1] = GRADE_KEYS[i + 1];
    if (hour >= h0 && hour <= h1) {
      const t = (hour - h0) / (h1 - h0);
      const ease = t * t * (3 - 2 * t);
      return [
        f0[0] + (f1[0] - f0[0]) * ease,
        f0[1] + (f1[1] - f0[1]) * ease,
        f0[2] + (f1[2] - f0[2]) * ease,
        f0[3] + (f1[3] - f0[3]) * ease,
        f0[4] + (f1[4] - f0[4]) * ease,
      ];
    }
  }
  return GRADE_NOON;
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

  root.addChild(
    buildBackdrop(viewWidth, viewHeight, layout),
    glass.back,
    contents,
    contentsMask,
    glass.front,
  );

  const grade = new ColorMatrixFilter();
  const applyGrade = (frame: GradeFrame): void => {
    grade.matrix = [
      frame[0], 0, 0, 0, frame[3],
      0, frame[1], 0, 0, 0.006,
      0, 0, frame[2], 0, frame[4],
      0, 0, 0, 1, 0,
    ];
  };
  applyGrade(GRADE_NOON);
  root.filters = [grade];

  stage.addChild(root);

  const slosh = createSlosh();
  let lastAmbientMs = 0;

  return {
    update(sim: SimState, population: readonly PopulationEntry[]): void {
      flora.update(sim);
      creatures.update(population);
      applyGrade(gradeForTime(sim.simTimeMs));
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
