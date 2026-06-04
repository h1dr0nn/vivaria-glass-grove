import { tickRandom } from "./rng";
import type { EnvSummary, SimScalars } from "./types";

/**
 * Living food web — invisible food pools + per-species populations that EAT,
 * are EATEN, and rise & fall over in-game days. Layered ON TOP of the v1
 * succession backbone (which stays the resource base); this module never
 * touches the v1 scalars, so the load-bearing golden-master keeps passing.
 *
 * SAFETY (per the sim-v2 red-team, all four BLOCKERs honored):
 *  - Every rate is per-HOUR and the whole flux is scaled by dtHours ONCE,
 *    then clamped, then exp() — non-negative & bounded even at an 86400-tick
 *    catch-up (BLOCKER-1).
 *  - Pools are DAMPED toward a stable equilibrium; the visible boom-bust
 *    comes from EXOGENOUS season+weather forcing (bounded sinusoids), never
 *    from sitting on a Neimark-Sacker limit cycle (BLOCKER-2).
 *  - Detritus has a real linear decay → self-regulates well below its cap,
 *    so the decomposer guild's food keeps fluctuating (BLOCKER-3).
 *  - A refuge floor means a pool can dip but never vanish → the render keeps
 *    ≥1 sprite for any present species (cozy no-dead-world, BLOCKER-4).
 *
 * DETERMINISM: pure function of (state, env, seed, tick). All summations
 * iterate the FROZEN canonical orders below (never object key order). RNG is
 * counter-based via tickRandom on a reserved stream block (≥10).
 */

const MAX_ARG = 3;
const REFUGE = 0.02; // a present pool never drops below this
const POOL_CAP = 1;
const HOURS_PER_DAY = 24;
const SEASON_DAYS = 28; // one slow turn of the wheel
const STREAM = { weather: 3 } as const;

// ---------------------------------------------------------------- food pools

export const FOOD_POOLS = ["plankton", "biofilm", "detritus"] as const;
export type FoodPoolId = (typeof FOOD_POOLS)[number];

interface FoodPoolDef {
  readonly id: FoodPoolId;
  /** intrinsic growth per hour (autotrophs); detritus uses inflow instead */
  readonly growthPerHour: number;
  /** which env scalar feeds it: light-driven (water) or moisture (land) */
  readonly resource: "light" | "moisture" | "detritus";
  /** linear decay per hour (detritus mineralization) */
  readonly decayPerHour: number;
}

const FOOD_DEFS: Record<FoodPoolId, FoodPoolDef> = {
  plankton: { id: "plankton", growthPerHour: 0.5, resource: "light", decayPerHour: 0 },
  biofilm: { id: "biofilm", growthPerHour: 0.4, resource: "moisture", decayPerHour: 0 },
  detritus: { id: "detritus", growthPerHour: 0, resource: "detritus", decayPerHour: 0.18 },
};

// ---------------------------------------------------------------- species web

/** Canonical species order — the ONLY order any summation may use. */
export const ECO_SPECIES = [
  "detritus-worm",
  "daphnia",
  "ramshorn-snail",
  "cherry-shrimp",
  "ember-tetra",
  "dwarf-cory",
  "springtail",
  "fiddler-crab",
  "froglet",
  "pond-turtle",
  "dwarf-isopod",
  "moss-snail",
  "leaf-beetle",
  "meadow-moth",
] as const;
export type EcoSpeciesId = (typeof ECO_SPECIES)[number];

interface EcoSpeciesDef {
  /** what it eats: food pool ids and/or prey species ids */
  readonly eats: ReadonlyArray<FoodPoolId | EcoSpeciesId>;
  /** conversion efficiency × attack rate, per hour */
  readonly intake: number;
  /** baseline mortality per hour */
  readonly mortality: number;
  /** how fast it recolonizes from the floor, per hour */
  readonly reseed: number;
  /** weather sensitivity (land creatures feel rain/heat more) */
  readonly weatherKind: "water" | "land";
}

const SPECIES_DEFS: Record<EcoSpeciesId, EcoSpeciesDef> = {
  "detritus-worm": { eats: ["detritus"], intake: 0.5, mortality: 0.2, reseed: 0.012, weatherKind: "water" },
  daphnia: { eats: ["plankton"], intake: 0.7, mortality: 0.3, reseed: 0.02, weatherKind: "water" },
  "ramshorn-snail": { eats: ["biofilm"], intake: 0.4, mortality: 0.16, reseed: 0.008, weatherKind: "water" },
  "cherry-shrimp": { eats: ["biofilm", "detritus"], intake: 0.45, mortality: 0.18, reseed: 0.01, weatherKind: "water" },
  "ember-tetra": { eats: ["daphnia", "plankton"], intake: 0.5, mortality: 0.16, reseed: 0.006, weatherKind: "water" },
  "dwarf-cory": { eats: ["detritus", "plankton"], intake: 0.4, mortality: 0.15, reseed: 0.006, weatherKind: "water" },
  springtail: { eats: ["detritus"], intake: 0.6, mortality: 0.25, reseed: 0.018, weatherKind: "land" },
  "fiddler-crab": { eats: ["detritus", "biofilm"], intake: 0.42, mortality: 0.16, reseed: 0.007, weatherKind: "land" },
  froglet: { eats: ["springtail", "leaf-beetle"], intake: 0.5, mortality: 0.15, reseed: 0.005, weatherKind: "land" },
  "pond-turtle": { eats: ["biofilm", "detritus"], intake: 0.35, mortality: 0.1, reseed: 0.003, weatherKind: "land" },
  "dwarf-isopod": { eats: ["detritus"], intake: 0.5, mortality: 0.2, reseed: 0.012, weatherKind: "land" },
  "moss-snail": { eats: ["biofilm"], intake: 0.38, mortality: 0.15, reseed: 0.008, weatherKind: "land" },
  "leaf-beetle": { eats: ["biofilm"], intake: 0.45, mortality: 0.2, reseed: 0.01, weatherKind: "land" },
  "meadow-moth": { eats: ["biofilm"], intake: 0.4, mortality: 0.22, reseed: 0.012, weatherKind: "land" },
};

/** predators of each prey species — derived once from the eats lists */
const PREDATORS: Record<EcoSpeciesId, EcoSpeciesId[]> = (() => {
  const map = Object.fromEntries(
    ECO_SPECIES.map((id) => [id, [] as EcoSpeciesId[]]),
  ) as Record<EcoSpeciesId, EcoSpeciesId[]>;
  for (const predator of ECO_SPECIES) {
    for (const food of SPECIES_DEFS[predator].eats) {
      if ((ECO_SPECIES as readonly string[]).includes(food)) {
        map[food as EcoSpeciesId].push(predator);
      }
    }
  }
  return map;
})();

// ---------------------------------------------------------------- state

export interface EcoState {
  readonly food: Readonly<Record<FoodPoolId, number>>;
  readonly pop: Readonly<Record<EcoSpeciesId, number>>;
}

export interface EnvironmentReading {
  /** 0..1 around the year, 0 = deep winter, 0.5 = high summer */
  readonly seasonPhase: number;
  readonly seasonName: "spring" | "summer" | "autumn" | "winter";
  readonly weather: "clear" | "sunny" | "overcast" | "rainy" | "muggy";
  /** growth multiplier this day from season+weather (bounded) */
  readonly growthMul: number;
}

const SEASON_NAMES = ["spring", "summer", "autumn", "winter"] as const;
const WEATHERS = ["clear", "sunny", "overcast", "rainy", "muggy"] as const;
const WEATHER_GROWTH: Record<EnvironmentReading["weather"], number> = {
  clear: 1.0,
  sunny: 1.12,
  overcast: 0.9,
  rainy: 1.05,
  muggy: 1.08,
};

/**
 * Season + weather as a PURE function of (seed, simTime) — recomputed every
 * tick, never read back from stored state (dodges the env-cache determinism
 * trap). Weather is a per-day deterministic roll.
 */
export function environmentAt(seed: number, simTimeMs: number): EnvironmentReading {
  const dayIndex = Math.floor(simTimeMs / (HOURS_PER_DAY * 3_600_000));
  const seasonPhase = ((dayIndex % SEASON_DAYS) / SEASON_DAYS + 1) % 1;
  const seasonName = SEASON_NAMES[Math.floor(seasonPhase * 4) % 4];
  // a real seasonal swing the player can SEE — lush summer, sparse winter
  const seasonMul = 1 + 0.35 * Math.sin(seasonPhase * Math.PI * 2);
  const roll = tickRandom(seed, dayIndex, STREAM.weather);
  const weather = WEATHERS[Math.min(WEATHERS.length - 1, Math.floor(roll * WEATHERS.length))];
  return {
    seasonPhase,
    seasonName,
    weather,
    growthMul: seasonMul * WEATHER_GROWTH[weather],
  };
}

/** Per-world personality: ±15% rate jitter per species, pure from seed. */
function jitterFor(seed: number, speciesIndex: number): number {
  const r = tickRandom(seed, 0, 100 + speciesIndex); // tick 0 = world-constant
  return 0.85 + r * 0.3;
}

/**
 * Which species ROLLED present in this world — the personality dice, pure
 * from seed, so two worlds with the same slider host a different cast. The
 * caller ANDs this with its own habitat check (sim: env; render: tank).
 * Each species has a presence chance; a few are near-certain, others rare.
 */
const PRESENCE_CHANCE: Record<EcoSpeciesId, number> = {
  "detritus-worm": 0.92,
  daphnia: 0.9,
  "ramshorn-snail": 0.85,
  "cherry-shrimp": 0.8,
  "ember-tetra": 0.7,
  "dwarf-cory": 0.55,
  springtail: 0.92,
  "fiddler-crab": 0.55,
  froglet: 0.6,
  "pond-turtle": 0.4,
  "dwarf-isopod": 0.85,
  "moss-snail": 0.7,
  "leaf-beetle": 0.65,
  "meadow-moth": 0.6,
};

export function worldHasSpecies(seed: number, id: string): boolean {
  if (!isEcoSpecies(id)) return true; // non-eco species always allowed
  const index = ECO_SPECIES.indexOf(id);
  const roll = tickRandom(seed, 1, 200 + index); // tick 1 = world-constant
  return roll < PRESENCE_CHANCE[id];
}

/** Sim-side presence: rolled present AND env supports the broad habitat. */
export function presenceFor(
  seed: number,
  env: EnvSummary,
): ReadonlySet<EcoSpeciesId> {
  const set = new Set<EcoSpeciesId>();
  const hasWater = env.waterFraction > 0.05;
  const hasLand = env.waterFraction < 0.95;
  for (const id of ECO_SPECIES) {
    if (!worldHasSpecies(seed, id)) continue;
    const kind = SPECIES_DEFS[id].weatherKind;
    if (kind === "water" && !hasWater) continue;
    if (kind === "land" && !hasLand) continue;
    set.add(id);
  }
  return set;
}

export function createInitialEco(): EcoState {
  const food = {} as Record<FoodPoolId, number>;
  for (const id of FOOD_POOLS) food[id] = REFUGE;
  const pop = {} as Record<EcoSpeciesId, number>;
  for (const id of ECO_SPECIES) pop[id] = 0;
  return { food, pop };
}

function holling(x: number): number {
  // Holling type III — a low-density refuge, strongly stabilizing
  const h = 0.3;
  return (x * x) / (h * h + x * x);
}

function clampPool(x: number, present: boolean): number {
  const floor = present ? REFUGE : 0;
  return Math.min(POOL_CAP, Math.max(floor, x));
}

/**
 * Advance the food web by ONE tick. Pure: same (eco, env, scalars, seed,
 * tick, dtHours) ⇒ same result. `present` gates which species exist in this
 * world (from species viability windows, decided by the caller).
 */
export function stepEco(
  eco: EcoState,
  env: EnvSummary,
  scalars: SimScalars,
  present: ReadonlySet<EcoSpeciesId>,
  seed: number,
  dtHours: number,
  simTimeMs: number,
): EcoState {
  const environment = environmentAt(seed, simTimeMs);
  const drive = environment.growthMul;

  // resource availability from the v1 backbone (read-only)
  const resourceLevel: Record<FoodPoolDef["resource"], number> = {
    light: env.light * (0.4 + 0.6 * scalars.algae),
    moisture: env.moisture * (0.4 + 0.6 * scalars.microbes),
    detritus: 0, // detritus is its own pool
  };

  // --- food pools ---
  const food = {} as Record<FoodPoolId, number>;
  let deathInflow = 0; // collected below, but detritus needs prev pops
  for (const id of ECO_SPECIES) {
    deathInflow += eco.pop[id] * SPECIES_DEFS[id].mortality * 0.5;
  }
  for (const id of FOOD_POOLS) {
    const def = FOOD_DEFS[id];
    const x = eco.food[id];
    let grazing = 0;
    for (const sp of ECO_SPECIES) {
      if (!SPECIES_DEFS[sp].eats.includes(id)) continue;
      grazing += SPECIES_DEFS[sp].intake * holling(x) * eco.pop[sp];
    }
    let next: number;
    if (id === "detritus") {
      // linear self-regulating pool: inflow − decay·x − grazing
      const flux = deathInflow + 0.04 - def.decayPerHour * x - grazing;
      next = x + flux * dtHours;
    } else {
      const res = resourceLevel[def.resource];
      const arg = clampArg(
        (def.growthPerHour * res * drive * (1 - x / POOL_CAP) - grazing) * dtHours,
      );
      next = x * Math.exp(arg) + 0.003 * dtHours;
    }
    food[id] = Math.min(POOL_CAP, Math.max(0, next));
  }

  // --- species populations ---
  const pop = {} as Record<EcoSpeciesId, number>;
  for (let i = 0; i < ECO_SPECIES.length; i++) {
    const id = ECO_SPECIES[i];
    const def = SPECIES_DEFS[id];
    const isPresent = present.has(id);
    const x = eco.pop[id];
    if (!isPresent) {
      pop[id] = 0;
      continue;
    }
    // food intake (Holling III over each food source, using PREVIOUS levels)
    let intake = 0;
    for (const src of def.eats) {
      const level = (FOOD_POOLS as readonly string[]).includes(src)
        ? food[src as FoodPoolId]
        : eco.pop[src as EcoSpeciesId];
      intake += holling(level);
    }
    intake = (intake / Math.max(1, def.eats.length)) * def.intake;
    // predation pressure from everything that eats THIS species
    let predation = 0;
    for (const pred of PREDATORS[id]) {
      predation += SPECIES_DEFS[pred].intake * 0.6 * holling(x) * eco.pop[pred];
    }
    // weather hits land & water creatures differently (rain helps land)
    const weatherFactor =
      def.weatherKind === "land"
        ? environment.weather === "rainy" || environment.weather === "muggy"
          ? 1.08
          : environment.weather === "sunny"
            ? 0.96
            : 1
        : drive;
    const jitter = jitterFor(seed, i);
    const arg = clampArg(
      (intake * weatherFactor * jitter - def.mortality - predation) * dtHours,
    );
    const next = x * Math.exp(arg) + def.reseed * dtHours;
    pop[id] = clampPool(next, true);
  }

  return { food, pop };
}

function clampArg(arg: number): number {
  return Math.min(MAX_ARG, Math.max(-MAX_ARG, arg));
}

/** Render-facing 0..1 abundance for a species (0 if absent). */
export function abundanceOf(eco: EcoState | undefined, id: string): number {
  if (!eco) return 0;
  if (!(id in eco.pop)) return 0;
  return eco.pop[id as EcoSpeciesId];
}

export function isEcoSpecies(id: string): id is EcoSpeciesId {
  return (ECO_SPECIES as readonly string[]).includes(id);
}

/** reserved tickRandom streams for the long-horizon gates */
export const ECO_STREAM = { visitor: 300, variant: 400 } as const;

const BIODIVERSITY_FLOOR = 0.06;

/** how many resident species the web currently sustains — drives late guilds */
export function biodiversityOf(eco: EcoState | undefined): number {
  if (!eco) return 0;
  let n = 0;
  for (const id of ECO_SPECIES) {
    if (eco.pop[id] >= BIODIVERSITY_FLOOR) n++;
  }
  return n;
}

const HOUR_MS_ = 3_600_000;
const NIGHT_OFFSET_HOURS = 9;

/** true in the deep-night window (matches the renderer's light cycle) */
export function isNight(simTimeMs: number): boolean {
  const hour = (simTimeMs / HOUR_MS_ + NIGHT_OFFSET_HOURS) % 24;
  return hour >= 20 || hour < 6;
}

/** a once-per-day deterministic rare-visitor roll */
export function visitorRoll(seed: number, simTimeMs: number, stream: number): number {
  const dayIndex = Math.floor(simTimeMs / (HOURS_PER_DAY * HOUR_MS_));
  return tickRandom(seed, dayIndex, stream);
}
