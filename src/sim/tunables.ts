/**
 * ALL balance constants live here, in ONE versioned object.
 * The save file stores hashTunables() so balance patches never silently
 * mutate an existing tank (docs/ARCHITECTURE.md → Persistence).
 */

export interface TierTunables {
  /** Logistic growth rate r, per sim hour */
  readonly growthRatePerHour: number;
  /** Tiny inoculation value a gated tier jumps to when its gate first opens */
  readonly seedFloor: number;
  /** Scalar value at which the tier is considered established */
  readonly establishThreshold: number;
  /** Required level of the previous tier before this one can appear (0 = none) */
  readonly gatePrevTier: number;
  /** Nutrient level that yields full growth speed (soft gate, scales below) */
  readonly nutrientRef: number;
  /** Nutrients consumed per unit of growth */
  readonly nutrientCost: number;
  /** ± fraction of per-tick growth noise (organic feel, bounded) */
  readonly jitter: number;
}

export interface SimTunables {
  readonly version: number;
  /** Fixed sim tick. Curves update only on absolute tick boundaries. */
  readonly tickMs: number;
  /** Offline catch-up clamp */
  readonly maxCatchupMs: number;
  /** Initial microbe inoculum (spores are everywhere) */
  readonly initialMicrobes: number;
  /** Nutrients generated per sim hour at full microbe biomass */
  readonly nutrientYieldPerHour: number;
  /** Nutrient pool cap */
  readonly nutrientMax: number;
  readonly microbes: TierTunables;
  readonly algae: TierTunables;
  readonly plants: TierTunables;
  /** Plants level at which visible fauna (grazers) arrive */
  readonly faunaTrigger: number;
}

/**
 * Default pacing targets (real-time feel, see DESIGN-BIBLE "three clocks"):
 * microbes visible in ~minutes, established < 1h; algae over a few hours;
 * plants over ~a day; first fauna a bit after plants establish.
 */
export const DEFAULT_TUNABLES: SimTunables = {
  version: 1,
  tickMs: 1000,
  maxCatchupMs: 24 * 60 * 60 * 1000,
  initialMicrobes: 0.001,
  nutrientYieldPerHour: 0.35,
  nutrientMax: 1,
  microbes: {
    growthRatePerHour: 9,
    seedFloor: 0.001,
    establishThreshold: 0.05,
    gatePrevTier: 0,
    nutrientRef: 0, // microbes feed on the substrate itself
    nutrientCost: 0,
    jitter: 0.1,
  },
  algae: {
    growthRatePerHour: 1.6,
    seedFloor: 0.002,
    establishThreshold: 0.05,
    gatePrevTier: 0.3,
    nutrientRef: 0.15,
    nutrientCost: 0.25,
    jitter: 0.1,
  },
  plants: {
    growthRatePerHour: 0.22,
    seedFloor: 0.002,
    establishThreshold: 0.05,
    gatePrevTier: 0.35,
    nutrientRef: 0.2,
    nutrientCost: 0.45,
    jitter: 0.08,
  },
  faunaTrigger: 0.45,
};

/** FNV-1a over a stable JSON encoding — cheap, stable across sessions. */
export function hashTunables(tunables: SimTunables): string {
  const json = JSON.stringify(tunables);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
