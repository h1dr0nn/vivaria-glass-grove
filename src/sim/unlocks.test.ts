import { describe, expect, test } from "vitest";
import { advanceSim, createInitialSimState } from "./integrate";
import { generateTank } from "./tankgen";
import { DEFAULT_TUNABLES, type SimTunables } from "./tunables";
import { environmentAt } from "./ecology";
import { SPECIES, populationFor } from "./species";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const FAST: SimTunables = {
  ...DEFAULT_TUNABLES,
  microbes: { ...DEFAULT_TUNABLES.microbes, growthRatePerHour: 400 },
  algae: { ...DEFAULT_TUNABLES.algae, growthRatePerHour: 120 },
  plants: { ...DEFAULT_TUNABLES.plants, growthRatePerHour: 60 },
  nutrientYieldPerHour: 12,
};

function mature(seed: number, land: number, totalMs: number) {
  const tank = generateTank(seed, land);
  let sim = createInitialSimState(seed);
  let remaining = totalMs;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 12 * HOUR_MS);
    sim = advanceSim(sim, chunk, tank.env, FAST).state;
    remaining -= chunk;
  }
  return { tank, sim };
}

function idsAt(seed: number, land: number, totalMs: number): string[] {
  const { tank, sim } = mature(seed, land, totalMs);
  return populationFor(tank, sim).map((e) => e.def.id);
}

describe("long-horizon roster", () => {
  test("the new arrivals exist in the roster", () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    for (const id of [
      "velvet-mite",
      "whirligig",
      "mayfly",
      "mason-bee",
      "dragonfly",
      "land-planarian",
      "heron",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test("a sterile tank shows nothing (gated arrivals included)", () => {
    const tank = generateTank(42, 40);
    const sim = createInitialSimState(42);
    expect(populationFor(tank, sim)).toEqual([]);
  });

  test("weather-gated velvet mites only appear on rainy/muggy days", () => {
    // find a paludarium world + two days of opposite weather, late enough
    const { tank } = mature(7, 45, 5 * DAY_MS);
    let sim = createInitialSimState(7);
    sim = advanceSim(sim, 5 * DAY_MS, tank.env, FAST).state;
    let rainyShown = false;
    let dryHidden = true;
    for (let d = 0; d < 28; d++) {
      sim = advanceSim(sim, DAY_MS, tank.env, FAST).state;
      const wet =
        environmentAt(7, sim.simTimeMs).weather === "rainy" ||
        environmentAt(7, sim.simTimeMs).weather === "muggy";
      const shown = populationFor(tank, sim).some(
        (e) => e.def.id === "velvet-mite",
      );
      if (wet && shown) rainyShown = true;
      if (!wet && shown) dryHidden = false;
    }
    expect(rainyShown).toBe(true);
    expect(dryHidden).toBe(true);
  });

  test("the roster a player SEES changes across the seasons", () => {
    const { tank } = mature(31, 50, 6 * DAY_MS);
    let sim = createInitialSimState(31);
    sim = advanceSim(sim, 6 * DAY_MS, tank.env, FAST).state;
    const rosters = new Set<string>();
    for (let d = 0; d < 28; d++) {
      sim = advanceSim(sim, DAY_MS, tank.env, FAST).state;
      rosters.add([...new Set(idsAtSim(tank, sim))].sort().join(","));
    }
    // the visible cast is not one fixed set all year
    expect(rosters.size).toBeGreaterThan(1);
  });

  test("the heron is rare — absent on most days", () => {
    const { tank } = mature(99, 50, 6 * DAY_MS);
    let sim = createInitialSimState(99);
    sim = advanceSim(sim, 6 * DAY_MS, tank.env, FAST).state;
    let heronDays = 0;
    const days = 60;
    for (let d = 0; d < days; d++) {
      sim = advanceSim(sim, DAY_MS, tank.env, FAST).state;
      if (populationFor(tank, sim).some((e) => e.def.id === "heron")) {
        heronDays++;
      }
    }
    expect(heronDays).toBeLessThan(days * 0.25); // a guest, not a resident
  });
});

function idsAtSim(
  tank: ReturnType<typeof generateTank>,
  sim: ReturnType<typeof createInitialSimState>,
): string[] {
  return populationFor(tank, sim).map((e) => e.def.id);
}
