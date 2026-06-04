import { describe, expect, test } from "vitest";
import { advanceSim, createInitialSimState } from "./integrate";
import { generateTank } from "./tankgen";
import { DEFAULT_TUNABLES, type SimTunables } from "./tunables";
import { SPECIES, populationFor, speciesById } from "./species";

const HOUR_MS = 3_600_000;

const FAST: SimTunables = {
  ...DEFAULT_TUNABLES,
  microbes: { ...DEFAULT_TUNABLES.microbes, growthRatePerHour: 400 },
  algae: { ...DEFAULT_TUNABLES.algae, growthRatePerHour: 120 },
  plants: { ...DEFAULT_TUNABLES.plants, growthRatePerHour: 60 },
  nutrientYieldPerHour: 12,
};

function matureSim(seed: number, land: number, hours: number) {
  const tank = generateTank(seed, land);
  let sim = createInitialSimState(seed);
  let remaining = hours * HOUR_MS;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 12 * HOUR_MS);
    sim = advanceSim(sim, chunk, tank.env, FAST).state;
    remaining -= chunk;
  }
  return { tank, sim };
}

describe("species roster sanity", () => {
  test("ids are unique", () => {
    const ids = new Set(SPECIES.map((s) => s.id));
    expect(ids.size).toBe(SPECIES.length);
  });

  test("speciesById resolves every roster id and rejects unknowns", () => {
    for (const s of SPECIES) {
      expect(speciesById(s.id)?.name).toBe(s.name);
    }
    expect(speciesById("krakenling")).toBeUndefined();
  });

  test("viability windows are valid", () => {
    for (const s of SPECIES) {
      expect(s.minLand).toBeGreaterThanOrEqual(0);
      expect(s.maxLand).toBeLessThanOrEqual(100);
      expect(s.minLand).toBeLessThan(s.maxLand);
      expect(s.threshold).toBeGreaterThan(0);
      expect(s.threshold).toBeLessThan(1);
      expect(s.maxCount).toBeGreaterThan(0);
    }
  });

  test("mixed-tank exclusives exist (paludarium is the richest)", () => {
    const exclusives = SPECIES.filter((s) => s.minLand > 5 && s.maxLand < 95);
    expect(exclusives.length).toBeGreaterThanOrEqual(2);
  });
});

describe("populationFor", () => {
  test("a sterile tank has no creatures", () => {
    const tank = generateTank(42, 30);
    const sim = createInitialSimState(42);
    expect(populationFor(tank, sim)).toEqual([]);
  });

  test("population grows with succession", () => {
    const { tank } = matureSim(42, 35, 0);
    let sim = createInitialSimState(42);
    let lastCount = 0;
    for (let i = 0; i < 6; i++) {
      sim = advanceSim(sim, 8 * HOUR_MS, tank.env, FAST).state;
      const total = populationFor(tank, sim).reduce(
        (sum, e) => sum + e.count,
        0,
      );
      expect(total).toBeGreaterThanOrEqual(lastCount);
      lastCount = total;
    }
    expect(lastCount).toBeGreaterThan(5);
  });

  test("respects land viability windows", () => {
    const aquarium = matureSim(42, 0, 60);
    const dryland = matureSim(42, 100, 60);
    const aquariumIds = populationFor(aquarium.tank, aquarium.sim).map(
      (e) => e.def.id,
    );
    const drylandIds = populationFor(dryland.tank, dryland.sim).map(
      (e) => e.def.id,
    );
    // fish never on dryland; springtails never in open water
    expect(aquariumIds).toContain("ember-tetra");
    expect(drylandIds).not.toContain("ember-tetra");
    expect(drylandIds).toContain("springtail");
    expect(aquariumIds).not.toContain("springtail");
  });

  test("mixed tanks host exclusives that pure tanks never see", () => {
    const paludarium = matureSim(42, 50, 80);
    const ids = populationFor(paludarium.tank, paludarium.sim).map(
      (e) => e.def.id,
    );
    expect(ids).toContain("fiddler-crab");
    expect(ids).toContain("froglet");

    const aquarium = matureSim(42, 0, 80);
    const aquariumIds = populationFor(aquarium.tank, aquarium.sim).map(
      (e) => e.def.id,
    );
    expect(aquariumIds).not.toContain("fiddler-crab");
    expect(aquariumIds).not.toContain("froglet");
  });

  test("is deterministic", () => {
    const { tank, sim } = matureSim(7, 40, 50);
    expect(populationFor(tank, sim)).toEqual(populationFor(tank, sim));
  });

  test("counts never exceed maxCount", () => {
    const { tank, sim } = matureSim(11, 45, 200);
    for (const entry of populationFor(tank, sim)) {
      expect(entry.count).toBeLessThanOrEqual(entry.def.maxCount);
    }
  });
});
