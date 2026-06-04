import { tickRandom } from "./rng";
import { DEFAULT_TUNABLES, type SimTunables, type TierTunables } from "./tunables";
import {
  PHASE_ORDER,
  type EnvSummary,
  type IntegrateResult,
  type SimEvent,
  type SimState,
  type SuccessionPhase,
} from "./types";

/**
 * THE single source of truth for time (docs/ARCHITECTURE.md → Simulation).
 *
 * The live tick, the resume catch-up, and tests all call this one pure
 * function. Curves update only on absolute tick boundaries derived from
 * simTimeMs, and randomness is counter-based per tick - therefore
 * N small calls and one batched call produce identical results.
 */

const STREAM = { microbes: 0, algae: 1, plants: 2 } as const;

interface Draft {
  microbes: number;
  algae: number;
  plants: number;
  nutrients: number;
  phase: SuccessionPhase;
}

export function createInitialSimState(
  seed: number,
  tunables: SimTunables = DEFAULT_TUNABLES,
): SimState {
  return {
    seed,
    simTimeMs: 0,
    phase: "sterile",
    scalars: {
      microbes: tunables.initialMicrobes,
      algae: 0,
      plants: 0,
    },
    pools: { nutrients: 0 },
  };
}

export function advanceSim(
  state: SimState,
  elapsedMs: number,
  env: EnvSummary,
  tunables: SimTunables = DEFAULT_TUNABLES,
): IntegrateResult {
  const clamped = clampElapsed(elapsedMs, tunables);
  if (clamped === 0) {
    return { state, events: [] };
  }

  const newSimTimeMs = state.simTimeMs + clamped;
  const firstTick = Math.floor(state.simTimeMs / tunables.tickMs) + 1;
  const lastTick = Math.floor(newSimTimeMs / tunables.tickMs);

  const draft: Draft = {
    microbes: state.scalars.microbes,
    algae: state.scalars.algae,
    plants: state.scalars.plants,
    nutrients: state.pools.nutrients,
    phase: state.phase,
  };
  const events: SimEvent[] = [];

  for (let tick = firstTick; tick <= lastTick; tick++) {
    runTick(draft, tick, state.seed, env, tunables, events);
  }

  return {
    state: {
      seed: state.seed,
      simTimeMs: newSimTimeMs,
      phase: draft.phase,
      scalars: {
        microbes: draft.microbes,
        algae: draft.algae,
        plants: draft.plants,
      },
      pools: { nutrients: draft.nutrients },
    },
    events,
  };
}

function clampElapsed(elapsedMs: number, tunables: SimTunables): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(Math.round(elapsedMs), tunables.maxCatchupMs);
}

function runTick(
  draft: Draft,
  tick: number,
  seed: number,
  env: EnvSummary,
  tunables: SimTunables,
  events: SimEvent[],
): void {
  const dtHours = tunables.tickMs / 3_600_000;

  // Microbes - feed on the sterile substrate, gated by environment only.
  const microbeEnv = envFactorMicrobes(env);
  draft.microbes = growTier(
    draft.microbes,
    tunables.microbes,
    microbeEnv,
    Number.POSITIVE_INFINITY, // no nutrient dependence
    tickRandom(seed, tick, STREAM.microbes),
    dtHours,
  ).next;

  // Nutrients - produced by microbial decomposition, capped.
  draft.nutrients = Math.min(
    tunables.nutrientMax,
    draft.nutrients + draft.microbes * tunables.nutrientYieldPerHour * dtHours,
  );

  // Algae - gated on microbes + nutrients, consumes nutrients.
  if (draft.microbes >= tunables.algae.gatePrevTier) {
    const grown = growGatedTier(
      draft,
      "algae",
      tunables.algae,
      envFactorAlgae(env),
      tickRandom(seed, tick, STREAM.algae),
      dtHours,
    );
    draft.algae = grown.next;
    draft.nutrients = Math.max(0, draft.nutrients - grown.consumed);
  }

  // Plants - gated on algae + nutrients, consumes nutrients.
  if (draft.algae >= tunables.plants.gatePrevTier) {
    const grown = growGatedTier(
      draft,
      "plants",
      tunables.plants,
      envFactorPlants(env),
      tickRandom(seed, tick, STREAM.plants),
      dtHours,
    );
    draft.plants = grown.next;
    draft.nutrients = Math.max(0, draft.nutrients - grown.consumed);
  }

  advancePhase(draft, tick, tunables, events);
}

interface GrowthStep {
  next: number;
  consumed: number;
}

/** One logistic Euler step at fixed dt with bounded seeded jitter. */
function growTier(
  current: number,
  tier: TierTunables,
  envFactor: number,
  nutrientFactor: number,
  random: number,
  dtHours: number,
): GrowthStep {
  const jitter = 1 + (random * 2 - 1) * tier.jitter;
  const limiter = Math.min(1, nutrientFactor);
  const delta =
    tier.growthRatePerHour * current * (1 - current) * envFactor * limiter * jitter * dtHours;
  const next = Math.min(1, Math.max(0, current + delta));
  return { next, consumed: Math.max(0, next - current) * tier.nutrientCost };
}

/** Growth for a tier that needs inoculation and nutrients. */
function growGatedTier(
  draft: Draft,
  id: "algae" | "plants",
  tier: TierTunables,
  envFactor: number,
  random: number,
  dtHours: number,
): GrowthStep {
  let current = draft[id];
  const nutrientFactor =
    tier.nutrientRef <= 0 ? 1 : draft.nutrients / tier.nutrientRef;
  // Inoculation: the gate opened on a barren tier - life finds a way in,
  // but only where conditions actually support it (no spores in dead zones).
  if (current < tier.seedFloor) {
    if (envFactor <= 0 || nutrientFactor <= 0) {
      return { next: current, consumed: 0 };
    }
    current = tier.seedFloor;
  }
  return growTier(current, tier, envFactor, nutrientFactor, random, dtHours);
}

function envFactorMicrobes(env: EnvSummary): number {
  // Microbial life mostly wants moisture; a bit of light warms things up.
  return clamp01(0.15 + 0.7 * env.moisture + 0.15 * env.light);
}

function envFactorAlgae(env: EnvSummary): number {
  // Algae need light and wet surfaces; thrive in watery tanks.
  return clamp01(env.light * (0.35 + 0.4 * env.waterFraction + 0.25 * env.moisture));
}

function envFactorPlants(env: EnvSummary): number {
  // Plants want light and moisture; pure-water tanks favor aquatics equally.
  return clamp01(env.light * (0.3 + 0.7 * env.moisture));
}

function advancePhase(
  draft: Draft,
  tick: number,
  tunables: SimTunables,
  events: SimEvent[],
): void {
  // Monotonic FSM: latch each phase the first time its trigger is met.
  let nextIndex = PHASE_ORDER.indexOf(draft.phase) + 1;
  while (nextIndex < PHASE_ORDER.length) {
    const next = PHASE_ORDER[nextIndex];
    if (!phaseTriggerMet(next, draft, tunables)) break;
    draft.phase = next;
    events.push({
      type: "phase-advanced",
      phase: next,
      atSimTimeMs: tick * tunables.tickMs,
    });
    nextIndex++;
  }
}

function phaseTriggerMet(
  phase: SuccessionPhase,
  draft: Draft,
  tunables: SimTunables,
): boolean {
  switch (phase) {
    case "microbes":
      return draft.microbes >= tunables.microbes.establishThreshold;
    case "algae":
      return draft.algae >= tunables.algae.establishThreshold;
    case "plants":
      return draft.plants >= tunables.plants.establishThreshold;
    case "fauna":
      return draft.plants >= tunables.faunaTrigger;
    default:
      return false;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
