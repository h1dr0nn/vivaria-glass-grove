import { describe, expect, test } from "vitest";
import { advanceSim, createInitialSimState } from "./integrate";
import { mulberry32 } from "./rng";
import { DEFAULT_TUNABLES, type SimTunables } from "./tunables";
import type { EnvSummary, SimState } from "./types";

const ENV_RIVERBANK: EnvSummary = {
  light: 0.7,
  moisture: 0.75,
  waterFraction: 0.7,
};

const ENV_DARK_DRY: EnvSummary = {
  light: 0,
  moisture: 0,
  waterFraction: 0,
};

/** Fast tunables so full succession happens within small simulated spans. */
const FAST: SimTunables = {
  ...DEFAULT_TUNABLES,
  microbes: { ...DEFAULT_TUNABLES.microbes, growthRatePerHour: 400 },
  algae: { ...DEFAULT_TUNABLES.algae, growthRatePerHour: 120 },
  plants: { ...DEFAULT_TUNABLES.plants, growthRatePerHour: 60 },
  nutrientYieldPerHour: 12,
};

const HOUR_MS = 3_600_000;

function deepFreeze<T extends object>(obj: T): T {
  for (const value of Object.values(obj)) {
    if (typeof value === "object" && value !== null) {
      deepFreeze(value as object);
    }
  }
  return Object.freeze(obj);
}

describe("createInitialSimState", () => {
  test("starts sterile with a tiny microbe inoculum", () => {
    const state = createInitialSimState(42);
    expect(state.phase).toBe("sterile");
    expect(state.scalars.microbes).toBeGreaterThan(0);
    expect(state.scalars.algae).toBe(0);
    expect(state.scalars.plants).toBe(0);
    expect(state.pools.nutrients).toBe(0);
    expect(state.simTimeMs).toBe(0);
  });
});

describe("advanceSim — time handling", () => {
  test("zero elapsed returns the same state and no events", () => {
    const state = createInitialSimState(42);
    const result = advanceSim(state, 0, ENV_RIVERBANK);
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });

  test("negative and non-finite elapsed are clamped to zero", () => {
    const state = createInitialSimState(42);
    expect(advanceSim(state, -5000, ENV_RIVERBANK).state).toBe(state);
    expect(advanceSim(state, Number.NaN, ENV_RIVERBANK).state).toBe(state);
    expect(advanceSim(state, Number.NEGATIVE_INFINITY, ENV_RIVERBANK).state).toBe(
      state,
    );
  });

  test("huge elapsed is clamped to maxCatchupMs", () => {
    const state = createInitialSimState(42);
    const result = advanceSim(state, 365 * 24 * HOUR_MS, ENV_RIVERBANK);
    expect(result.state.simTimeMs).toBe(DEFAULT_TUNABLES.maxCatchupMs);
  });

  test("does not mutate the input state", () => {
    const state = deepFreeze(createInitialSimState(42));
    expect(() => advanceSim(state, 10 * HOUR_MS, ENV_RIVERBANK, FAST)).not.toThrow();
  });

  test("sub-tick elapsed accumulates simTime without curve updates", () => {
    const state = createInitialSimState(42);
    const result = advanceSim(state, 400, ENV_RIVERBANK);
    expect(result.state.simTimeMs).toBe(400);
    expect(result.state.scalars).toEqual(state.scalars);
  });
});

describe("advanceSim — determinism (load-bearing)", () => {
  test("same state + same elapsed = identical result", () => {
    const state = createInitialSimState(42);
    const a = advanceSim(state, 6 * HOUR_MS, ENV_RIVERBANK, FAST);
    const b = advanceSim(state, 6 * HOUR_MS, ENV_RIVERBANK, FAST);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  test("GOLDEN MASTER: N stepped calls === one batched call", () => {
    const total = 4 * HOUR_MS;
    const splitRng = mulberry32(777);

    for (let run = 0; run < 25; run++) {
      const seed = Math.floor(splitRng() * 2 ** 31);
      let stepped: SimState = createInitialSimState(seed);
      let remaining = total;
      while (remaining > 0) {
        // random integer-ms chunks from 1ms to ~37 minutes
        const chunk = Math.min(
          remaining,
          1 + Math.floor(splitRng() * 2_222_222),
        );
        stepped = advanceSim(stepped, chunk, ENV_RIVERBANK, FAST).state;
        remaining -= chunk;
      }

      const batched = advanceSim(
        createInitialSimState(seed),
        total,
        ENV_RIVERBANK,
        FAST,
      ).state;

      expect(stepped).toEqual(batched);
    }
  });

  test("different seeds give different trajectories", () => {
    const a = advanceSim(createInitialSimState(1), HOUR_MS, ENV_RIVERBANK, FAST);
    const b = advanceSim(createInitialSimState(2), HOUR_MS, ENV_RIVERBANK, FAST);
    expect(a.state.scalars).not.toEqual(b.state.scalars);
  });
});

describe("advanceSim — succession arc", () => {
  test("phases advance in order with one event each", () => {
    let state = createInitialSimState(42);
    const allEvents = [];
    for (let i = 0; i < 48; i++) {
      const result = advanceSim(state, HOUR_MS, ENV_RIVERBANK, FAST);
      state = result.state;
      allEvents.push(...result.events);
    }
    const phases = allEvents.map((e) => e.phase);
    expect(phases).toEqual(["microbes", "algae", "plants", "fauna"]);
    expect(state.phase).toBe("fauna");
    // events carry monotonically increasing timestamps
    const times = allEvents.map((e) => e.atSimTimeMs);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  test("phase never regresses", () => {
    let state = createInitialSimState(42);
    let bestIndex = 0;
    const order = ["sterile", "microbes", "algae", "plants", "fauna"];
    for (let i = 0; i < 60; i++) {
      state = advanceSim(state, HOUR_MS / 2, ENV_RIVERBANK, FAST).state;
      const index = order.indexOf(state.phase);
      expect(index).toBeGreaterThanOrEqual(bestIndex);
      bestIndex = index;
    }
  });

  test("scalars stay in [0,1] and nutrients within [0,max] over long spans", () => {
    let state = createInitialSimState(42);
    for (let i = 0; i < 30; i++) {
      state = advanceSim(state, 2 * HOUR_MS, ENV_RIVERBANK, FAST).state;
      for (const value of Object.values(state.scalars)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(state.pools.nutrients).toBeGreaterThanOrEqual(0);
      expect(state.pools.nutrients).toBeLessThanOrEqual(
        DEFAULT_TUNABLES.nutrientMax,
      );
    }
  });

  test("algae cannot appear before microbes establish", () => {
    let state = createInitialSimState(42);
    // Advance in small steps; whenever algae exists, microbes must be past gate
    for (let i = 0; i < 200; i++) {
      state = advanceSim(state, HOUR_MS / 10, ENV_RIVERBANK, FAST).state;
      if (state.scalars.algae > 0) {
        expect(state.scalars.microbes).toBeGreaterThanOrEqual(
          FAST.algae.gatePrevTier,
        );
      }
    }
  });

  test("nothing grows in a dark, bone-dry tank beyond a microbial trickle", () => {
    let state = createInitialSimState(42);
    state = advanceSim(state, 24 * HOUR_MS, ENV_DARK_DRY, FAST).state;
    expect(state.scalars.algae).toBe(0);
    expect(state.scalars.plants).toBe(0);
    // microbes may creep on residual baseline but never establish quickly
    expect(state.phase === "sterile" || state.phase === "microbes").toBe(true);
  });

  test("wet bright tanks grow algae faster than dry dim ones", () => {
    const wet = { light: 0.9, moisture: 0.9, waterFraction: 0.9 };
    const dry = { light: 0.4, moisture: 0.25, waterFraction: 0.05 };
    let a = createInitialSimState(42);
    let b = createInitialSimState(42);
    for (let i = 0; i < 12; i++) {
      a = advanceSim(a, HOUR_MS, wet, FAST).state;
      b = advanceSim(b, HOUR_MS, dry, FAST).state;
    }
    expect(a.scalars.algae).toBeGreaterThan(b.scalars.algae);
  });

  test("default tunables hit the designed pacing bands", () => {
    // microbes establish within the first hour; algae within ~8h; plants by ~3 days
    let state = createInitialSimState(7);
    state = advanceSim(state, HOUR_MS, ENV_RIVERBANK).state;
    expect(state.phase).toBe("microbes");
    state = advanceSim(state, 8 * HOUR_MS, ENV_RIVERBANK).state;
    expect(["algae", "plants"]).toContain(state.phase);
    state = advanceSim(state, 24 * HOUR_MS, ENV_RIVERBANK).state;
    state = advanceSim(state, 24 * HOUR_MS, ENV_RIVERBANK).state;
    state = advanceSim(state, 15 * HOUR_MS, ENV_RIVERBANK).state;
    expect(["plants", "fauna"]).toContain(state.phase);
  });
});
