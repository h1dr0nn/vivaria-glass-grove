import { describe, expect, test } from "vitest";
import { advanceSim, createInitialSimState } from "./integrate";
import {
  ECO_SPECIES,
  FOOD_POOLS,
  environmentAt,
  presenceFor,
  worldHasSpecies,
} from "./ecology";
import type { EnvSummary } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const ENV_PALUDARIUM: EnvSummary = {
  light: 0.8,
  moisture: 0.8,
  waterFraction: 0.5,
};

function run(seed: number, totalMs: number, env = ENV_PALUDARIUM) {
  let sim = createInitialSimState(seed);
  let remaining = totalMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 12 * HOUR_MS);
    sim = advanceSim(sim, chunk, env).state;
    remaining -= chunk;
  }
  return sim;
}

describe("environmentAt — deterministic season + weather", () => {
  test("pure function of (seed, simTime)", () => {
    expect(environmentAt(7, 5 * DAY_MS)).toEqual(environmentAt(7, 5 * DAY_MS));
  });

  test("growth multiplier stays gently bounded", () => {
    for (let d = 0; d < 120; d++) {
      const g = environmentAt(42, d * DAY_MS).growthMul;
      expect(g).toBeGreaterThan(0.7);
      expect(g).toBeLessThan(1.4);
    }
  });

  test("seasons cycle through all four names over a year", () => {
    const names = new Set<string>();
    for (let d = 0; d < 28; d++) names.add(environmentAt(1, d * DAY_MS).seasonName);
    expect(names.size).toBe(4);
  });
});

describe("per-world personality", () => {
  test("worldHasSpecies is deterministic", () => {
    for (const id of ECO_SPECIES) {
      expect(worldHasSpecies(99, id)).toBe(worldHasSpecies(99, id));
    }
  });

  test("two worlds host a different cast", () => {
    const a = ECO_SPECIES.filter((id) => worldHasSpecies(1, id)).join();
    const b = ECO_SPECIES.filter((id) => worldHasSpecies(2, id)).join();
    expect(a).not.toBe(b);
  });

  test("presence respects broad habitat (no water species in a dry tank)", () => {
    const dry: EnvSummary = { light: 0.8, moisture: 0.3, waterFraction: 0 };
    const present = presenceFor(7, dry);
    expect(present.has("ember-tetra")).toBe(false);
    expect(present.has("daphnia")).toBe(false);
  });
});

describe("ecology — determinism (stepped === batched)", () => {
  test("many small steps equal one call, within the 24h catch-up clamp", () => {
    const total = 20 * HOUR_MS; // under maxCatchupMs so one call isn't clamped
    let stepped = createInitialSimState(31);
    let remaining = total;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 37 * 60_000 + 113); // odd chunk
      stepped = advanceSim(stepped, chunk, ENV_PALUDARIUM).state;
      remaining -= chunk;
    }
    const batched = advanceSim(
      createInitialSimState(31),
      total,
      ENV_PALUDARIUM,
    ).state;
    expect(stepped.eco).toEqual(batched.eco);
  });

  test("same seed reaches the same food web every run", () => {
    expect(run(55, 5 * DAY_MS).eco).toEqual(run(55, 5 * DAY_MS).eco);
  });
});

describe("ecology — stability (no extinction, no blowup)", () => {
  test("every present species stays within [0,1] across a long life", () => {
    let sim = createInitialSimState(42);
    for (let d = 0; d < 60; d++) {
      sim = advanceSim(sim, DAY_MS, ENV_PALUDARIUM).state;
      for (const id of ECO_SPECIES) {
        const v = sim.eco!.pop[id];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      for (const id of FOOD_POOLS) {
        expect(sim.eco!.food[id]).toBeGreaterThanOrEqual(0);
        expect(sim.eco!.food[id]).toBeLessThanOrEqual(1);
      }
    }
  });

  test("repeated 24h catch-ups never drive a present species extinct", () => {
    for (const seed of [1, 7, 42, 100, 256, 777]) {
      let sim = createInitialSimState(seed);
      // mature first
      sim = advanceSim(sim, 10 * DAY_MS, ENV_PALUDARIUM).state;
      const present = presenceFor(seed, ENV_PALUDARIUM);
      // then five big offline jumps
      for (let i = 0; i < 5; i++) {
        sim = advanceSim(sim, DAY_MS, ENV_PALUDARIUM).state;
      }
      for (const id of present) {
        // a present species must keep at least the refuge floor
        expect(sim.eco!.pop[id]).toBeGreaterThan(0.015);
      }
    }
  });

  test("detritus self-regulates well below its cap (BLOCKER-3)", () => {
    let sim = createInitialSimState(42);
    sim = advanceSim(sim, 30 * DAY_MS, ENV_PALUDARIUM).state;
    expect(sim.eco!.food.detritus).toBeLessThan(0.85);
  });

  test("populations actually MOVE over days (rise and fall, not static)", () => {
    let sim = createInitialSimState(42);
    sim = advanceSim(sim, 8 * DAY_MS, ENV_PALUDARIUM).state;
    const totalPop = (): number =>
      ECO_SPECIES.reduce((s, id) => s + sim.eco!.pop[id], 0);
    const samples: number[] = [];
    for (let d = 0; d < 25; d++) {
      sim = advanceSim(sim, DAY_MS, ENV_PALUDARIUM).state;
      samples.push(totalPop());
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    // the community biomass breathes across the season, not a flat line
    expect(max - min).toBeGreaterThan(0.05);
  });
});
