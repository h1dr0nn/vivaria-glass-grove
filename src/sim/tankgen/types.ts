import type { EnvSummary } from "../types";

/**
 * Tank generation output. Coordinates: x = column 0..width-1 (left→right),
 * y = row 0..height-1 measured from the BOTTOM of the tank upward.
 */

export const GEN_VERSION = 10; // v10: per-world slope personality (gentle beaches exist)

export const MATERIAL = {
  air: 0,
  water: 1,
  drainage: 2,
  soil: 3,
  sand: 4,
  litter: 5,
  rock: 6,
  wood: 7,
} as const;

export type MaterialId = (typeof MATERIAL)[keyof typeof MATERIAL];

export const ZONE = {
  none: 0,
  deepWater: 1,
  shallows: 2,
  shore: 3,
  lowland: 4,
  midland: 5,
  highland: 6,
} as const;

export type ZoneId = (typeof ZONE)[keyof typeof ZONE];

export type Archetype =
  | "open-water"
  | "riverbank"
  | "paludarium"
  | "hillside"
  | "dryland";

export interface HardscapePiece {
  readonly kind: "rock" | "driftwood";
  /** center column */
  readonly x: number;
  /** center row (from bottom) */
  readonly y: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
}

export interface TankState {
  readonly genVersion: number;
  readonly seed: number;
  /** 0..100 - the player's slider */
  readonly landPercent: number;
  readonly archetype: Archetype;
  readonly width: number;
  readonly height: number;
  /** Rows are usable up to this height; above is glass headroom (always air) */
  readonly usableHeight: number;
  /** Per column: terrain surface height in cells from the bottom */
  readonly terrainHeight: readonly number[];
  /** Water surface row (cells from bottom); 0 = no standing water */
  readonly waterlineY: number;
  /** width*height material ids, index = y * width + x */
  readonly materials: Uint8Array;
  /** width*height zone ids, index = y * width + x */
  readonly zones: Uint8Array;
  /** width*height light 0..1 */
  readonly light: Float32Array;
  /** width*height moisture 0..1 */
  readonly moisture: Float32Array;
  readonly hardscape: readonly HardscapePiece[];
  /** Aggregates consumed by the succession sim */
  readonly env: EnvSummary;
}

export function archetypeOf(landPercent: number): Archetype {
  if (landPercent <= 5) return "open-water";
  if (landPercent <= 30) return "riverbank";
  if (landPercent <= 69) return "paludarium";
  if (landPercent <= 94) return "hillside";
  return "dryland";
}

export function cellIndex(width: number, x: number, y: number): number {
  return y * width + x;
}
