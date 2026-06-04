import type { SimState, TierId } from "./types";
import type { TankState } from "./tankgen";
import { abundanceOf, isEcoSpecies, worldHasSpecies } from "./ecology";

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
export function populationFor(
  tank: TankState,
  sim: SimState,
): PopulationEntry[] {
  const entries: PopulationEntry[] = [];
  for (const def of SPECIES) {
    if (tank.landPercent < def.minLand || tank.landPercent > def.maxLand) {
      continue;
    }
    if (!habitatExists(tank, def.habitat)) continue;
    if (!worldHasSpecies(sim.seed, def.id)) continue;
    const scalar = sim.scalars[def.tier];
    if (scalar < def.threshold) continue; // tier hasn't unlocked it yet

    const abundance = abundanceOf(sim.eco, def.id);
    let count: number;
    if (isEcoSpecies(def.id)) {
      if (abundance < ECO_VISIBLE_FLOOR) continue; // resting below the floor
      // map pool 0..1 → 1..maxCount, gently boosted so a healthy pool fills
      const fill = Math.min(1, abundance * 1.6);
      count = Math.max(1, Math.round(def.maxCount * fill));
    } else {
      const growth = Math.min(
        1,
        ((scalar - def.threshold) / Math.max(0.001, 1 - def.threshold)) * 1.4,
      );
      count = Math.max(1, Math.round(def.maxCount * growth));
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
