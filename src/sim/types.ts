/**
 * Core simulation types. This module is PURE — no Pixi, no DOM, no Tauri.
 */

export type SuccessionPhase =
  | "sterile"
  | "microbes"
  | "algae"
  | "plants"
  | "fauna";

export const PHASE_ORDER: readonly SuccessionPhase[] = [
  "sterile",
  "microbes",
  "algae",
  "plants",
  "fauna",
];

export type TierId = "microbes" | "algae" | "plants";

/**
 * Aggregate environment produced by tank generation (static fields summarized).
 * The sim reads these as constants — there is no live chemistry solver.
 */
export interface EnvSummary {
  /** 0..1 mean light reaching growable surfaces */
  readonly light: number;
  /** 0..1 mean substrate moisture */
  readonly moisture: number;
  /** 0..1 fraction of tank volume that is water */
  readonly waterFraction: number;
}

export interface SimScalars {
  /** Each tier is biomass normalized to its carrying capacity, 0..1 */
  readonly microbes: number;
  readonly algae: number;
  readonly plants: number;
}

export interface SimPools {
  /** Free nutrients available for growth, 0..1 normalized */
  readonly nutrients: number;
}

export interface SimState {
  readonly seed: number;
  /** Total simulated time in integer milliseconds */
  readonly simTimeMs: number;
  /** Monotonic — never regresses once a phase is reached */
  readonly phase: SuccessionPhase;
  readonly scalars: SimScalars;
  readonly pools: SimPools;
}

export interface SimEvent {
  readonly type: "phase-advanced";
  readonly phase: SuccessionPhase;
  readonly atSimTimeMs: number;
}

export interface IntegrateResult {
  readonly state: SimState;
  readonly events: readonly SimEvent[];
}
