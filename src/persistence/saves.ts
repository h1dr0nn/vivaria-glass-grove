import type { SimState, SuccessionPhase } from "../sim/types";
import type { TankState } from "../sim/tankgen";
import { createInitialEco, type EcoState } from "../sim/ecology";
import { DEFAULT_TUNABLES, hashTunables } from "../sim/tunables";
import { migrateSave } from "./migrations";
import { CURRENT_SAVE_VERSION, saveSchema, type SaveData } from "./saveSchema";

/** Pure build/parse/restore helpers around the save format. */

interface DiscoveryLike {
  readonly phase: SuccessionPhase;
  readonly atSimTimeMs: number;
}

export function buildSave(
  tank: TankState,
  sim: SimState,
  discoveries: readonly DiscoveryLike[],
  savedAtUnixMs: number,
  speciesDiscovered: ReadonlyMap<string, number> = new Map(),
): SaveData {
  return {
    schemaVersion: CURRENT_SAVE_VERSION,
    tunablesHash: hashTunables(DEFAULT_TUNABLES),
    savedAtUnixMs,
    seed: tank.seed,
    landPercent: tank.landPercent,
    genVersion: tank.genVersion,
    sim: {
      simTimeMs: sim.simTimeMs,
      phase: sim.phase,
      scalars: { ...sim.scalars },
      pools: { ...sim.pools },
      eco: sim.eco
        ? { food: { ...sim.eco.food }, pop: { ...sim.eco.pop } }
        : undefined,
    },
    discoveries: discoveries.map((d) => ({
      phase: d.phase,
      atSimTimeMs: d.atSimTimeMs,
    })),
    speciesDiscovered: [...speciesDiscovered.entries()].map(
      ([id, atSimTimeMs]) => ({ id, atSimTimeMs }),
    ),
  };
}

/** A legitimate save is a few KB - refuse absurd files before parsing. */
const MAX_SAVE_BYTES = 1_000_000;

/** Parse untrusted JSON into a validated save, or null. Never throws. */
export function parseSave(json: string): SaveData | null {
  if (json.length > MAX_SAVE_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;

  const migrated = migrateSave(raw as Record<string, unknown>);
  if (!migrated) return null;

  const result = saveSchema.safeParse(migrated);
  return result.success ? result.data : null;
}

/** Reconstruct the runtime SimState from a validated save. */
export function restoreSim(save: SaveData): SimState {
  return {
    seed: save.seed,
    simTimeMs: save.sim.simTimeMs,
    phase: save.sim.phase,
    scalars: { ...save.sim.scalars },
    pools: { ...save.sim.pools },
    eco: save.sim.eco
      ? restoreEco(save.sim.eco)
      : undefined,
  };
}

/** Rebuild the canonical eco state, filling any absent ids from the roster. */
function restoreEco(saved: {
  food: Record<string, number>;
  pop: Record<string, number>;
}): EcoState {
  const fresh = createInitialEco();
  const food = { ...fresh.food } as Record<string, number>;
  const pop = { ...fresh.pop } as Record<string, number>;
  for (const id of Object.keys(food)) {
    if (saved.food[id] !== undefined) food[id] = saved.food[id];
  }
  for (const id of Object.keys(pop)) {
    if (saved.pop[id] !== undefined) pop[id] = saved.pop[id];
  }
  return { food, pop } as EcoState;
}
