import type { SimState, TierId } from "./types";
import type { TankState } from "./tankgen";
import {
  ECO_STREAM,
  abundanceOf,
  biodiversityOf,
  environmentAt,
  isEcoSpecies,
  isNight,
  visitorRoll,
  worldHasSpecies,
} from "./ecology";

/**
 * Species roster - pure data + a pure population function.
 * Every species carries a [minLand, maxLand] viability window (DESIGN-BIBLE):
 * mixed-tank exclusives only exist between the extremes, so the paludarium
 * middle is the richest world. Population derives deterministically from
 * (tank, sim) - no hidden creature state in the save.
 */

export type Habitat = "water" | "floor" | "shore" | "land" | "air";

export type Movement =
  | "drift"
  | "swim"
  | "school"
  | "crawl"
  | "hop"
  | "scuttle"
  | "wiggle"
  | "fly"
  | "amble";

/**
 * Long-horizon unlock gate. Stacking these orthogonal axes on top of the
 * succession tier keeps "first sighting" beats firing far past climax —
 * seasonal-only flyers, weather blooms, late predator/visitor guilds that
 * only a mature, diverse, lucky world ever surfaces. All pure from
 * (seed, simTime, eco, env) so a long fast-forward reveals them on schedule.
 */
export type UnlockGate =
  | { readonly kind: "tier" }
  | { readonly kind: "biodiversity"; readonly min: number }
  | { readonly kind: "season"; readonly seasons: readonly string[] }
  | { readonly kind: "night" }
  | { readonly kind: "weather"; readonly weathers: readonly string[] }
  | { readonly kind: "plants"; readonly min: number }
  | {
      readonly kind: "visitor";
      readonly chancePerDay: number;
      readonly stream: number;
      readonly requiresBiodiversity?: number;
      readonly requiresSpecies?: string;
    }
  | { readonly kind: "all"; readonly of: readonly UnlockGate[] };

export interface SpeciesDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** which succession scalar gates this species */
  readonly tier: TierId;
  /** scalar value at which the first individuals appear */
  readonly threshold: number;
  readonly minLand: number;
  readonly maxLand: number;
  readonly habitat: Habitat;
  readonly maxCount: number;
  /** body size in cells */
  readonly size: number;
  readonly color: number;
  readonly accent: number;
  readonly movement: Movement;
  /** extra gate beyond the tier threshold (default: tier only) */
  readonly unlock?: UnlockGate;
}

export const SPECIES: readonly SpeciesDef[] = [
  // ---------------------------------------------------------- aquatic
  {
    id: "detritus-worm",
    name: "Detritus worms",
    blurb: "Tiny threads stirring the new sediment.",
    tier: "microbes",
    threshold: 0.5,
    minLand: 0,
    maxLand: 90,
    habitat: "floor",
    maxCount: 5,
    size: 1.2,
    color: 0xd8c8b0,
    accent: 0xb8a890,
    movement: "wiggle",
  },
  {
    id: "daphnia",
    name: "Water fleas",
    blurb: "A drifting galaxy of specks, grazing the green water.",
    tier: "algae",
    threshold: 0.25,
    minLand: 0,
    maxLand: 70,
    habitat: "water",
    maxCount: 14,
    size: 0.6,
    color: 0xe8dcc0,
    accent: 0xd0c0a0,
    movement: "drift",
  },
  {
    id: "ramshorn-snail",
    name: "Ramshorn snails",
    blurb: "Patient spirals mowing the algae lawns.",
    tier: "algae",
    threshold: 0.45,
    minLand: 0,
    maxLand: 85,
    habitat: "floor",
    maxCount: 4,
    size: 2.0,
    color: 0xa8704d,
    accent: 0x7d4f33,
    movement: "crawl",
  },
  {
    id: "cherry-shrimp",
    name: "Cherry shrimp",
    blurb: "Little red gardeners, always busy among the stems.",
    tier: "plants",
    threshold: 0.3,
    minLand: 0,
    maxLand: 75,
    habitat: "floor",
    maxCount: 6,
    size: 1.9,
    color: 0xc94f4f,
    accent: 0xe8807a,
    movement: "scuttle",
  },
  {
    id: "ember-tetra",
    name: "Ember tetras",
    blurb: "A warm spark of fish, moving as one thought.",
    tier: "plants",
    threshold: 0.5,
    minLand: 0,
    maxLand: 45,
    habitat: "water",
    maxCount: 8,
    size: 2.2,
    color: 0xe08a3c,
    accent: 0xc96a2a,
    movement: "school",
  },
  {
    id: "dwarf-cory",
    name: "Dwarf corydoras",
    blurb: "Whiskered sand-sifters patrolling the deep floor.",
    tier: "plants",
    threshold: 0.65,
    minLand: 0,
    maxLand: 35,
    habitat: "floor",
    maxCount: 3,
    size: 2.6,
    color: 0xb8b09a,
    accent: 0x8a8470,
    movement: "scuttle",
  },
  // ------------------------------------------------- shore (exclusives)
  {
    id: "springtail",
    name: "Springtails",
    blurb: "The first cleanup crew - popping through the litter.",
    tier: "microbes",
    threshold: 0.6,
    minLand: 10,
    maxLand: 100,
    habitat: "land",
    maxCount: 10,
    size: 0.8,
    color: 0xeae4d4,
    accent: 0xcfc8b4,
    movement: "hop",
  },
  {
    id: "fiddler-crab",
    name: "Fiddler crabs",
    blurb: "One big claw, waving hello across the tideline.",
    tier: "plants",
    threshold: 0.55,
    minLand: 25,
    maxLand: 75,
    habitat: "shore",
    maxCount: 2,
    size: 2.6,
    color: 0xc78a50,
    accent: 0xe8b06a,
    movement: "scuttle",
  },
  {
    id: "froglet",
    name: "Froglets",
    blurb: "Fresh from the shallows, learning what land is.",
    tier: "plants",
    threshold: 0.7,
    minLand: 20,
    maxLand: 80,
    habitat: "shore",
    maxCount: 2,
    size: 2.7,
    color: 0x7da95c,
    accent: 0x5c8a44,
    movement: "hop",
  },
  {
    id: "pond-turtle",
    name: "Pond turtle",
    blurb: "An unhurried elder, basking wherever the light is kind.",
    tier: "plants",
    threshold: 0.6,
    minLand: 25,
    maxLand: 80,
    habitat: "land",
    maxCount: 1,
    size: 3.2,
    color: 0x6b8456,
    accent: 0x4f6342,
    movement: "amble",
  },
  // ----------------------------------------------------------- land
  {
    id: "dwarf-isopod",
    name: "Dwarf isopods",
    blurb: "Armored recyclers turning litter into soil.",
    tier: "algae",
    threshold: 0.35,
    minLand: 20,
    maxLand: 100,
    habitat: "land",
    maxCount: 6,
    size: 1.4,
    color: 0x9a948a,
    accent: 0x7a746a,
    movement: "crawl",
  },
  {
    id: "moss-snail",
    name: "Moss snails",
    blurb: "Slow wanderers leaving silver ribbons on the green.",
    tier: "plants",
    threshold: 0.4,
    minLand: 45,
    maxLand: 100,
    habitat: "land",
    maxCount: 3,
    size: 1.8,
    color: 0xb09a6e,
    accent: 0x8a7450,
    movement: "crawl",
  },
  {
    id: "leaf-beetle",
    name: "Leaf beetles",
    blurb: "Lacquered green buttons trundling the understory.",
    tier: "plants",
    threshold: 0.55,
    minLand: 60,
    maxLand: 100,
    habitat: "land",
    maxCount: 4,
    size: 1.3,
    color: 0x4f7d52,
    accent: 0x6fa86f,
    movement: "crawl",
  },
  {
    id: "meadow-moth",
    name: "Meadow moths",
    blurb: "Soft wings tracing slow loops in the warm air.",
    tier: "plants",
    threshold: 0.75,
    minLand: 55,
    maxLand: 100,
    habitat: "air",
    maxCount: 3,
    size: 1.6,
    color: 0xe8d8a8,
    accent: 0xc9b888,
    movement: "fly",
  },
  {
    id: "pygmy-rasbora",
    name: "Pygmy rasboras",
    blurb: "A shimmer of tiny silver-blue fish moving as one.",
    tier: "plants",
    threshold: 0.45,
    minLand: 0,
    maxLand: 60,
    habitat: "water",
    maxCount: 9,
    size: 1.3,
    color: 0x9bb8c4,
    accent: 0xd98a6a,
    movement: "school",
  },
  {
    id: "cherry-barb",
    name: "Cherry barb",
    blurb: "A lone deep-red fish cruising the open water.",
    tier: "plants",
    threshold: 0.55,
    minLand: 0,
    maxLand: 55,
    habitat: "water",
    maxCount: 3,
    size: 1.7,
    color: 0xc23b3b,
    accent: 0x8a2424,
    movement: "swim",
  },
  // ---- long-horizon arrivals: render-only, gated so they surface late ----
  {
    id: "velvet-mite",
    name: "Velvet mites",
    blurb: "Plush crimson dots that bloom across the damp after rain.",
    tier: "plants",
    threshold: 0.4,
    minLand: 20,
    maxLand: 100,
    habitat: "land",
    maxCount: 6,
    size: 1.0,
    color: 0xc02828,
    accent: 0x8c1d1d,
    movement: "scuttle",
    unlock: { kind: "weather", weathers: ["rainy", "muggy"] },
  },
  {
    id: "whirligig",
    name: "Whirligig beetles",
    blurb: "Black pearls tracing loops on a bright summer surface.",
    tier: "plants",
    threshold: 0.45,
    minLand: 5,
    maxLand: 80,
    habitat: "shore",
    maxCount: 5,
    size: 0.9,
    color: 0x2b2b30,
    accent: 0x4a4a52,
    movement: "scuttle",
    unlock: {
      kind: "all",
      of: [
        { kind: "season", seasons: ["summer"] },
        { kind: "weather", weathers: ["sunny", "clear"] },
      ],
    },
  },
  {
    id: "mayfly",
    name: "Mayfly hatch",
    blurb: "A spring emergence — twin-tailed wings rising over the water.",
    tier: "plants",
    threshold: 0.5,
    minLand: 0,
    maxLand: 80,
    habitat: "air",
    maxCount: 5,
    size: 1.4,
    color: 0xf2ead0,
    accent: 0xcfc4a0,
    movement: "fly",
    unlock: { kind: "season", seasons: ["spring"] },
  },
  {
    id: "mason-bee",
    name: "Mason bee",
    blurb: "A fuzzy pollinator, here only when the flowers are out.",
    tier: "plants",
    threshold: 0.9,
    minLand: 40,
    maxLand: 100,
    habitat: "air",
    maxCount: 2,
    size: 1.4,
    color: 0xd8a23a,
    accent: 0x4a4640,
    movement: "fly",
    unlock: {
      kind: "all",
      of: [
        { kind: "season", seasons: ["spring", "summer"] },
        { kind: "plants", min: 0.9 },
      ],
    },
  },
  {
    id: "dragonfly",
    name: "Dragonfly",
    blurb: "A summer hunter, darting and hovering over open water.",
    tier: "plants",
    threshold: 0.6,
    minLand: 0,
    maxLand: 90,
    habitat: "air",
    maxCount: 2,
    size: 2.6,
    color: 0x6aa6c0,
    accent: 0x3f7f96,
    movement: "fly",
    unlock: {
      kind: "all",
      of: [
        { kind: "season", seasons: ["summer"] },
        { kind: "biodiversity", min: 6 },
      ],
    },
  },
  {
    id: "land-planarian",
    name: "Hammerhead worm",
    blurb: "A slow amber ribbon hunting the mature forest floor.",
    tier: "plants",
    threshold: 0.85,
    minLand: 45,
    maxLand: 100,
    habitat: "land",
    maxCount: 2,
    size: 2.0,
    color: 0xc8a060,
    accent: 0x9a7440,
    movement: "crawl",
    unlock: { kind: "biodiversity", min: 6 },
  },
  {
    id: "heron",
    name: "Grey heron",
    blurb: "A rare, patient giant stalking the shallows — then gone.",
    tier: "plants",
    threshold: 0.5,
    minLand: 20,
    maxLand: 80,
    habitat: "shore",
    maxCount: 1,
    size: 9,
    color: 0xbfc4c0,
    accent: 0x8a8f8b,
    movement: "amble",
    unlock: {
      kind: "visitor",
      chancePerDay: 0.04,
      stream: ECO_STREAM.visitor,
      requiresBiodiversity: 8,
    },
  },
] as const;

export interface PopulationEntry {
  readonly def: SpeciesDef;
  readonly count: number;
}

/**
 * Deterministic population from (tank, sim) — the render layer only reads.
 *
 * A species shows only if: it fits the land window, its habitat exists, the
 * succession tier has unlocked it (gate), AND it rolled present in this world.
 * Once present, the live COUNT tracks the ecology pool (rises and falls over
 * days). Cozy invariant: a present, above-refuge species always shows ≥1
 * sprite — it never silently reads as "extinct".
 */
interface UnlockCtx {
  readonly seed: number;
  readonly simTimeMs: number;
  readonly scalar: number;
  readonly threshold: number;
  readonly biodiversity: number;
  readonly season: string;
  readonly weather: string;
  readonly night: boolean;
  readonly plants: number;
  readonly residents: ReadonlySet<string>;
}

/** Pure unlock resolver — every branch reads only the deterministic ctx. */
function isUnlocked(gate: UnlockGate | undefined, ctx: UnlockCtx): boolean {
  if (!gate || gate.kind === "tier") return ctx.scalar >= ctx.threshold;
  switch (gate.kind) {
    case "biodiversity":
      return ctx.biodiversity >= gate.min;
    case "season":
      return gate.seasons.includes(ctx.season);
    case "night":
      return ctx.night;
    case "weather":
      return gate.weathers.includes(ctx.weather);
    case "plants":
      return ctx.plants >= gate.min;
    case "visitor": {
      if (gate.requiresBiodiversity && ctx.biodiversity < gate.requiresBiodiversity) {
        return false;
      }
      if (gate.requiresSpecies && !ctx.residents.has(gate.requiresSpecies)) {
        return false;
      }
      return visitorRoll(ctx.seed, ctx.simTimeMs, gate.stream) < gate.chancePerDay;
    }
    case "all":
      return gate.of.every((g) => isUnlocked(g, ctx));
    default:
      return false;
  }
}

export function populationFor(
  tank: TankState,
  sim: SimState,
): PopulationEntry[] {
  const env = environmentAt(sim.seed, sim.simTimeMs);
  const biodiversity = biodiversityOf(sim.eco);
  const night = isNight(sim.simTimeMs);
  const residents = new Set<string>();
  for (const d of SPECIES) {
    if (isEcoSpecies(d.id) && abundanceOf(sim.eco, d.id) >= ECO_VISIBLE_FLOOR) {
      residents.add(d.id);
    }
  }

  const entries: PopulationEntry[] = [];
  for (const def of SPECIES) {
    if (tank.landPercent < def.minLand || tank.landPercent > def.maxLand) {
      continue;
    }
    if (!habitatExists(tank, def.habitat)) continue;
    if (!worldHasSpecies(sim.seed, def.id)) continue;
    const scalar = sim.scalars[def.tier];
    // tier threshold is the baseline for EVERY species (keeps a sterile tank
    // empty); the unlock gate then layers on season/weather/biodiversity/luck
    if (scalar < def.threshold) continue;

    const ctx: UnlockCtx = {
      seed: sim.seed,
      simTimeMs: sim.simTimeMs,
      scalar,
      threshold: def.threshold,
      biodiversity,
      season: env.seasonName,
      weather: env.weather,
      night,
      plants: sim.scalars.plants,
      residents,
    };
    if (!isUnlocked(def.unlock, ctx)) continue;

    let count: number;
    if (isEcoSpecies(def.id)) {
      const abundance = abundanceOf(sim.eco, def.id);
      if (abundance < ECO_VISIBLE_FLOOR) continue; // resting below the floor
      const fill = Math.min(1, abundance * 1.6);
      count = Math.max(1, Math.round(def.maxCount * fill));
    } else {
      // gated arrivals show their full small group while their window is open
      count = def.maxCount;
    }
    entries.push({ def, count });
  }
  return entries;
}

/** below this pool level a species is "resting" — shown as 0 sprites */
const ECO_VISIBLE_FLOOR = 0.04;

function habitatExists(tank: TankState, habitat: Habitat): boolean {
  const hasWater = tank.waterlineY > 2;
  const hasLand = tank.terrainHeight.some((h) => h >= tank.waterlineY);
  const hasShore =
    hasWater &&
    tank.terrainHeight.some((h) => Math.abs(h - tank.waterlineY) <= 3);
  switch (habitat) {
    case "water":
      return hasWater;
    case "floor":
      return hasWater;
    case "shore":
      return hasShore;
    case "land":
      return hasLand;
    case "air":
      return hasLand;
    default:
      return false;
  }
}

export function speciesById(id: string): SpeciesDef | undefined {
  return SPECIES.find((s) => s.id === id);
}
