import { mulberry32, splitSeed } from "../rng";
import { fbm1D } from "./noise";

/** Sub-stream ids — keep stable forever (determinism contract). */
export const STREAMS = {
  terrain: 0,
  water: 1,
  substrate: 2,
  hardscape: 3,
  biome: 4,
} as const;

export interface TerrainResult {
  readonly terrainHeight: number[];
  readonly waterlineY: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * STEPS 1–2 — terrain + waterline.
 *
 * The slider's promise is VISUAL: ~landPercent% of columns are emergent land.
 * We pick the waterline first (deeper water for watery tanks), then shape a
 * basin below it and a land plateau above it, splitting columns at the
 * slider's fraction with a soft blend — the blend slope crossing the
 * waterline is what creates a natural beach/shore band. A seeded tilt sign
 * decides whether land rises on the left or the right.
 */
export function generateTerrain(
  seed: number,
  landPercent: number,
  width: number,
  usableHeight: number,
): TerrainResult {
  const rng = mulberry32(splitSeed(seed, STREAMS.terrain));
  const p = landPercent / 100;

  const waterlineY =
    p >= 1 ? 0 : Math.round(usableHeight * lerp(0.55, 0.08, p));
  const waterDepth = usableHeight * lerp(0.45, 0.15, p);
  const basinFloor = Math.max(2, Math.round(waterlineY - waterDepth));
  const landTop = Math.min(
    usableHeight - 4,
    Math.round(waterlineY + usableHeight * lerp(0.18, 0.55, p)),
  );

  const landOnRight = rng() < 0.5;
  const edge = 1 - p; // land occupies u > edge
  // Slope discipline: the climb from basin to plateau must read as a gentle
  // bank (≲45°), so the blend width scales with the height it has to cover.
  const heightDelta = Math.max(1, landTop - basinFloor);
  const slopeColumns = heightDelta * (1.3 + rng() * 0.5);
  const blend = Math.min(0.45, Math.max(0.12, slopeColumns / width));
  const amplitude = lerp(0.04, 0.085, p) * usableHeight;
  const frequency = 0.02 + rng() * 0.014;
  const noiseSeed = splitSeed(seed, STREAMS.terrain) ^ 0x5bd1e995;

  const terrainHeight: number[] = new Array<number>(width);
  for (let x = 0; x < width; x++) {
    const t = x / (width - 1);
    const u = landOnRight ? t : 1 - t;
    const bias = p <= 0 ? 0 : smoothstep((u - edge) / blend + 0.5);
    // rolling hills on land, calmer floor under water
    const n = (fbm1D(noiseSeed, x * frequency) * 2 - 1) * (0.45 + 0.75 * bias);
    const h = Math.round(
      basinFloor + bias * (landTop - basinFloor) + n * amplitude,
    );
    terrainHeight[x] = Math.min(usableHeight - 4, Math.max(2, h));
  }

  fillHiddenPockets(terrainHeight, waterlineY);

  return { terrainHeight, waterlineY };
}

/**
 * ONE clean body of water: noise can dip land columns back below the
 * waterline behind the bank crest, creating hidden pocket-ponds that render
 * as glitchy pale patches inside the hill. Keep only the widest water run;
 * raise every other pocket just above the waterline (it reads as a berm).
 */
function fillHiddenPockets(terrain: number[], waterlineY: number): void {
  if (waterlineY <= 0) return;
  interface Run {
    start: number;
    end: number;
  }
  const runs: Run[] = [];
  let start = -1;
  for (let x = 0; x <= terrain.length; x++) {
    const isWater = x < terrain.length && terrain[x] < waterlineY;
    if (isWater && start < 0) start = x;
    if (!isWater && start >= 0) {
      runs.push({ start, end: x });
      start = -1;
    }
  }
  if (runs.length <= 1) return;
  let main = runs[0];
  for (const run of runs) {
    if (run.end - run.start > main.end - main.start) main = run;
  }
  for (const run of runs) {
    if (run === main) continue;
    for (let x = run.start; x < run.end; x++) {
      terrain[x] = waterlineY + 1;
    }
  }
}

/** Submerged cell count for a given water surface row (used by env/tests). */
export function waterVolumeAt(
  terrain: readonly number[],
  waterlineY: number,
): number {
  let volume = 0;
  for (const h of terrain) {
    volume += Math.max(0, waterlineY - h);
  }
  return volume;
}

/** Fraction of columns whose terrain rises above the waterline. */
export function emergentLandFraction(
  terrain: readonly number[],
  waterlineY: number,
): number {
  if (terrain.length === 0) return 0;
  let landColumns = 0;
  for (const h of terrain) {
    if (h >= waterlineY) landColumns++;
  }
  return landColumns / terrain.length;
}
