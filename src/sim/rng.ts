/**
 * Deterministic PRNG utilities. ALL randomness in the sim and procgen must
 * come from here - never Math.random().
 *
 * Two kinds:
 * - mulberry32: sequential stream for one-shot generation (tankgen passes).
 * - tickRandom: counter-based, a pure function of (seed, tick, stream) so
 *   stepped and batched integration produce identical results by construction.
 */

/** 32-bit avalanche mix → uint32. */
export function mix32(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Sequential PRNG (mulberry32). Returns values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent sub-stream seed from a master seed. */
export function splitSeed(seed: number, streamId: number): number {
  return mix32(mix32(seed ^ 0x9e3779b9) + Math.imul(streamId + 1, 0x85ebca6b));
}

/**
 * Counter-based random in [0, 1): pure function of (seed, tick, stream).
 * Keyed by the absolute tick index - no hidden sequential state.
 * Ticks can exceed 2^32; fold high bits in so long games stay well-mixed.
 */
export function tickRandom(seed: number, tick: number, stream: number): number {
  const tickLo = tick >>> 0;
  const tickHi = Math.floor(tick / 4294967296) >>> 0;
  let h = mix32(seed);
  h = mix32(h ^ mix32(tickLo));
  h = mix32(h ^ mix32(tickHi ^ 0x6a09e667));
  h = mix32(h ^ Math.imul(stream + 1, 0x9e3779b9));
  return h / 4294967296;
}
