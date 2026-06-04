import { describe, expect, test } from "vitest";
import { writeFileSync, appendFileSync } from "node:fs";
import { advanceSim, createInitialSimState } from "./integrate";
import { generateTank } from "./tankgen";
import { populationFor } from "./species";
import type { SimState } from "./types";

const OUT = "D:/Projects/Brainstorm/rct-terarium/_verify_out.txt";
writeFileSync(OUT, "");
function log(s: string): void {
  appendFileSync(OUT, s + "\n");
}

const HOUR_MS = 3_600_000;
const STEP_MS = HOUR_MS / 10; // 6-min resolution

/** March a fresh tank forward; report the simHour the predicate first holds. */
function hoursUntil(
  seed: number,
  landPercent: number,
  predicate: (sim: SimState) => boolean,
  maxHours = 240,
): number | null {
  const tank = generateTank(seed, landPercent);
  let sim = createInitialSimState(seed);
  const steps = Math.floor((maxHours * HOUR_MS) / STEP_MS);
  for (let i = 0; i < steps; i++) {
    sim = advanceSim(sim, STEP_MS, tank.env).state;
    if (predicate(sim)) return sim.simTimeMs / HOUR_MS;
  }
  return null;
}

function envFor(seed: number, landPercent: number) {
  return generateTank(seed, landPercent).env;
}

describe("VERIFY: fauna arrival timing", () => {
  const seeds = [1, 7, 42, 12345, 999];

  for (const land of [0, 35, 100]) {
    test(`env + fauna-gate (plants>=0.45) @ land=${land}`, () => {
      for (const seed of seeds) {
        const env = envFor(seed, land);
        const faunaH = hoursUntil(
          seed,
          land,
          (s) => s.scalars.plants >= 0.45,
        );
        // first ANY visible creature (population > 0)
        const firstCreatureH = hoursUntil(seed, land, (s) => {
          const tank = generateTank(seed, land);
          return populationFor(tank, s).length > 0;
        });
        // first NON-microbe-tier creature (i.e. algae/plants tier movers)
        const firstNonMicrobeH = hoursUntil(seed, land, (s) => {
          const tank = generateTank(seed, land);
          return populationFor(tank, s).some(
            (e) => e.def.tier !== "microbes",
          );
        });

        log(
          `land=${land} seed=${seed} ` +
            `env={l:${env.light.toFixed(2)},m:${env.moisture.toFixed(
              2,
            )},wf:${env.waterFraction.toFixed(2)}} ` +
            `faunaGateH=${faunaH === null ? ">240" : faunaH.toFixed(1)} ` +
            `firstCreatureH=${
              firstCreatureH === null ? ">240" : firstCreatureH.toFixed(1)
            } ` +
            `firstNonMicrobeH=${
              firstNonMicrobeH === null ? ">240" : firstNonMicrobeH.toFixed(1)
            }`,
        );
      }
      expect(true).toBe(true);
    });
  }

  test("per-species first-appearance for riverbank (land=35, seed=42)", () => {
    const land = 35;
    const seed = 42;
    const tank = generateTank(seed, land);
    const reported = new Set<string>();
    let sim = createInitialSimState(seed);
    const steps = Math.floor((240 * HOUR_MS) / STEP_MS);
    for (let i = 0; i < steps; i++) {
      sim = advanceSim(sim, STEP_MS, tank.env).state;
      for (const e of populationFor(tank, sim)) {
        if (!reported.has(e.def.id)) {
          reported.add(e.def.id);
          log(
            `  ${e.def.id} (tier=${e.def.tier}) first @ ${(
              sim.simTimeMs / HOUR_MS
            ).toFixed(1)}h`,
          );
        }
      }
    }
    expect(true).toBe(true);
  });
});
