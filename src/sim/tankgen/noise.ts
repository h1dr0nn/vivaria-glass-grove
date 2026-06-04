import { mix32 } from "../rng";

/**
 * 1D value noise + fBm for terrain synthesis. Pure functions of (seed, x) -
 * no sequential state, so passes stay reorderable and reproducible.
 */

function latticeValue(seed: number, xi: number): number {
  return mix32(mix32(seed) ^ (Math.imul(xi | 0, 0x9e3779b9) >>> 0)) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1) at continuous coordinate x. */
export function valueNoise1D(seed: number, x: number): number {
  const xi = Math.floor(x);
  const xf = x - xi;
  const a = latticeValue(seed, xi);
  const b = latticeValue(seed, xi + 1);
  return a + (b - a) * smooth(xf);
}

export interface FbmOptions {
  readonly octaves: number;
  readonly lacunarity: number;
  readonly gain: number;
}

export const DEFAULT_FBM: FbmOptions = {
  octaves: 3,
  lacunarity: 2,
  gain: 0.5,
};

/** Fractional Brownian motion in [0, 1), normalized over octave amplitudes. */
export function fbm1D(
  seed: number,
  x: number,
  options: FbmOptions = DEFAULT_FBM,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < options.octaves; i++) {
    sum += valueNoise1D(mix32(seed + i * 101), x * frequency) * amplitude;
    norm += amplitude;
    amplitude *= options.gain;
    frequency *= options.lacunarity;
  }
  return sum / norm;
}
