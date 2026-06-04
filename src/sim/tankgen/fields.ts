import type { EnvSummary } from "../types";
import { MATERIAL, ZONE, cellIndex } from "./types";

/**
 * STEP 5 - static environment fields. These are closed-form lookups computed
 * once at generation. There is NO live diffusion solver (docs/ARCHITECTURE.md):
 * the sim reads aggregates of these as constants.
 */

// Gentle per-cell dimming - a glass tank's water column is shallow, so deep
// zones dim noticeably but never go pitch dark.
const WATER_ATTENUATION = 0.985;
const SOLID_SURFACE_LIGHT_DECAY = 0.02;

/** Top-down light attenuation per column. */
export function computeLight(
  materials: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const light = new Float32Array(width * height);
  for (let x = 0; x < width; x++) {
    let l = 1;
    for (let y = height - 1; y >= 0; y--) {
      const i = cellIndex(width, x, y);
      light[i] = l;
      const material = materials[i];
      if (material === MATERIAL.water) {
        l *= WATER_ATTENUATION;
      } else if (material !== MATERIAL.air) {
        l *= SOLID_SURFACE_LIGHT_DECAY;
      }
    }
  }
  return light;
}

/**
 * Moisture: 1 underwater; above the waterline it decays with height and with
 * horizontal distance to open water; a misting baseline keeps the substrate
 * surface workable even in dry tanks.
 */
export function computeMoisture(
  materials: Uint8Array,
  terrain: readonly number[],
  waterlineY: number,
  width: number,
  height: number,
  landPercent: number,
): Float32Array {
  const moisture = new Float32Array(width * height);
  const distToWater = horizontalDistanceToWater(terrain, waterlineY, width);
  const ambient = 0.55 - 0.2 * (landPercent / 100);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = cellIndex(width, x, y);
      if (materials[i] === MATERIAL.water || y < waterlineY) {
        moisture[i] = 1;
        continue;
      }
      const vertical = Math.max(0, 1 - ((y - waterlineY) / height) * 2.0);
      const horizontal =
        distToWater[x] === Number.POSITIVE_INFINITY
          ? 0
          : Math.max(0, 1 - distToWater[x] / (width * 0.5));
      let m = vertical * (0.3 + 0.7 * horizontal);
      // misting baseline in the habitable band just above the substrate
      if (y - terrain[x] <= 2) {
        m = Math.max(m, ambient);
      }
      moisture[i] = Math.min(1, Math.max(0, m));
    }
  }
  return moisture;
}

function horizontalDistanceToWater(
  terrain: readonly number[],
  waterlineY: number,
  width: number,
): number[] {
  const dist = new Array<number>(width).fill(Number.POSITIVE_INFINITY);
  // forward and backward sweeps from water columns
  let last = Number.POSITIVE_INFINITY;
  for (let x = 0; x < width; x++) {
    last = terrain[x] < waterlineY ? 0 : last + 1;
    dist[x] = Math.min(dist[x], last);
  }
  last = Number.POSITIVE_INFINITY;
  for (let x = width - 1; x >= 0; x--) {
    last = terrain[x] < waterlineY ? 0 : last + 1;
    dist[x] = Math.min(dist[x], last);
  }
  return dist;
}

/** Zone classification (DESIGN-BIBLE zone system). */
export function computeZones(
  materials: Uint8Array,
  terrain: readonly number[],
  waterlineY: number,
  width: number,
  height: number,
): Uint8Array {
  const zones = new Uint8Array(width * height); // none = 0
  const maxTerrain = Math.max(...terrain);
  const deepBoundary = waterlineY * 0.45;

  for (let x = 0; x < width; x++) {
    const surface = terrain[x];
    const isShoreColumn = waterlineY > 0 && Math.abs(surface - waterlineY) <= 3;
    for (let y = 0; y < height; y++) {
      const i = cellIndex(width, x, y);
      const material = materials[i];

      if (material === MATERIAL.water) {
        zones[i] =
          waterlineY >= 8 && y < deepBoundary ? ZONE.deepWater : ZONE.shallows;
        if (isShoreColumn && waterlineY - y <= 2) zones[i] = ZONE.shore;
        continue;
      }

      // habitable band: surface cap + a few cells of air above it
      const aboveSurface = y - surface;
      if (aboveSurface >= -1 && aboveSurface <= 3 && surface >= waterlineY) {
        if (isShoreColumn) {
          zones[i] = ZONE.shore;
        } else {
          const span = Math.max(1, maxTerrain - waterlineY);
          const elevation = (surface - waterlineY) / span;
          zones[i] =
            elevation < 0.34
              ? ZONE.lowland
              : elevation < 0.67
                ? ZONE.midland
                : ZONE.highland;
        }
      }
    }
  }
  return zones;
}

/** Aggregates consumed by the succession sim. */
export function summarizeEnv(
  materials: Uint8Array,
  light: Float32Array,
  moisture: Float32Array,
  terrain: readonly number[],
  waterlineY: number,
  width: number,
  usableHeight: number,
): EnvSummary {
  let waterColumns = 0;
  let habitableLight = 0;
  let habitableMoisture = 0;
  let habitableCount = 0;

  for (let x = 0; x < width; x++) {
    if (terrain[x] < waterlineY) waterColumns++;
    for (let y = 0; y < usableHeight; y++) {
      const i = cellIndex(width, x, y);
      if (materials[i] === MATERIAL.water) {
        habitableLight += light[i];
        habitableMoisture += moisture[i];
        habitableCount++;
      }
    }
    // the growable band just above the substrate surface
    const surfaceY = Math.min(terrain[x], usableHeight - 1);
    const i = cellIndex(width, x, surfaceY);
    habitableLight += light[i];
    habitableMoisture += moisture[i];
    habitableCount++;
  }

  return {
    light: habitableCount > 0 ? habitableLight / habitableCount : 0,
    moisture: habitableCount > 0 ? habitableMoisture / habitableCount : 0,
    // How aquatic this world is - fraction of columns under water. Mirrors
    // the slider's visual promise and stays monotonic across it.
    waterFraction: width > 0 ? waterColumns / width : 0,
  };
}
