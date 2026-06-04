import { mulberry32, splitSeed } from "../rng";
import { fbm1D } from "./noise";

/** Sub-stream ids - keep stable forever (determinism contract). */
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

/**
 * STEPS 1–2 - terrain + waterline.
 *
 * The slider's promise is VISUAL: ~landPercent% of columns are emergent land.
 * We pick the waterline first (deeper water for watery tanks), then shape a
 * basin below it and a land plateau above it, splitting columns at the
 * slider's fraction with a soft blend - the blend slope crossing the
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
    p >= 1 ? 0 : Math.round(usableHeight * lerp(0.52, 0.1, p));
  const waterDepth = usableHeight * lerp(0.42, 0.16, p);
  const basinFloor = Math.max(2, Math.round(waterlineY - waterDepth));
  // Low bank in MIXED tanks (so it reads as a shore, not a cliff over the
  // pond) but still tall in land-dominant tanks (which need real highland).
  const landRelief = 0.12 + 0.42 * p ** 1.4;
  const landTop = Math.min(
    usableHeight - 4,
    Math.round(waterlineY + usableHeight * landRelief),
  );

  // ----- LAYOUT: roll FIRST (determinism), pick from those that fit p -----
  const layoutRoll = rng();
  const layout = pickLayout(layoutRoll, p);

  const landOnRight = rng() < 0.5;
  const slopeFactor = 1.2 + rng() ** 1.4 * 3.3;
  const heightDelta = Math.max(1, landTop - basinFloor);
  const amplitude = lerp(0.04, 0.085, p) * usableHeight;
  const frequency = 0.02 + rng() * 0.014;
  const noiseSeed = splitSeed(seed, STREAMS.terrain) ^ 0x5bd1e995;

  // Pick the EXACT land columns per layout (count = round(p·width)) so the
  // emergent-land fraction equals p by construction, whatever the shape.
  const landCols = Math.round(p * width);
  const landMask = buildLandMask(layout, width, landCols, landOnRight);

  // height comes from the signed distance to the nearest shore boundary: land
  // columns climb from the waterline up to landTop, water columns fall to the
  // basin — a real beach slope whose steepness is the per-world slopeFactor.
  const boundaries: number[] = [];
  for (let x = 1; x < width; x++) {
    if (landMask[x] !== landMask[x - 1]) boundaries.push(x - 0.5);
  }
  const reliefScale = layout === "beach" ? 0.55 : 1;
  // the bank can be gentle (esp. a beach), but the pond still drops to its
  // floor within ~1.5× its depth so deep water actually exists
  const bankCols = Math.min(
    width * 0.4,
    Math.max(3, heightDelta * slopeFactor * (layout === "beach" ? 2.2 : 1)),
  );
  const landRise = ((landTop - waterlineY) * reliefScale) / bankCols;
  const waterDepthCells = Math.max(1, waterlineY - basinFloor);
  const waterCols = Math.max(3, waterDepthCells * 1.5);
  const waterFall = waterDepthCells / waterCols;

  const terrainHeight: number[] = new Array<number>(width);
  for (let x = 0; x < width; x++) {
    let dist = width;
    for (const b of boundaries) dist = Math.min(dist, Math.abs(x - b));
    if (boundaries.length === 0) dist = width; // all land or all water
    const damp = Math.min(1, dist / 2); // don't let noise flip shore columns
    const n = (fbm1D(noiseSeed, x * frequency) * 2 - 1) * amplitude * damp;
    let h: number;
    if (landMask[x]) {
      h = Math.min(landTop, waterlineY + 0.6 + dist * landRise) + n;
    } else {
      h = Math.max(basinFloor, waterlineY - 0.6 - dist * waterFall) + n * 0.5;
    }
    terrainHeight[x] = Math.min(usableHeight - 4, Math.max(2, Math.round(h)));
  }

  killNoisePockets(terrainHeight, waterlineY, Math.max(4, Math.floor(width * 0.04)));

  return { terrainHeight, waterlineY };
}

/** exact land/water column assignment per layout (land count fixed = landCols) */
function buildLandMask(
  layout: TerrainLayout,
  width: number,
  landCols: number,
  landOnRight: boolean,
): boolean[] {
  const mask = new Array<boolean>(width).fill(false);
  if (landCols <= 0) return mask;
  if (landCols >= width) return mask.fill(true);
  switch (layout) {
    case "central-pond": {
      // land on both edges, water in the middle
      const left = Math.floor(landCols / 2);
      const right = landCols - left;
      for (let x = 0; x < width; x++) {
        mask[x] = x < left || x >= width - right;
      }
      break;
    }
    case "island": {
      // land in the middle, water both sides
      const start = Math.floor((width - landCols) / 2);
      for (let x = start; x < start + landCols; x++) mask[x] = true;
      break;
    }
    default: {
      // single bank / beach — land on one seeded side
      for (let i = 0; i < landCols; i++) {
        mask[landOnRight ? width - 1 - i : i] = true;
      }
      break;
    }
  }
  return mask;
}

export type TerrainLayout =
  | "single-bank"
  | "central-pond"
  | "island"
  | "beach";

/** Seeded layout choice — central-pond/island need both land & water present. */
function pickLayout(roll: number, p: number): TerrainLayout {
  const eligible: TerrainLayout[] = ["single-bank", "beach"];
  if (p >= 0.2 && p <= 0.8) {
    eligible.push("central-pond", "island");
  }
  return eligible[Math.floor(roll * eligible.length) % eligible.length];
}

/**
 * Kill only TINY noise puddles (genuine fBm dips behind a crest that read as
 * glitchy pale patches) while keeping every REAL pool. Layouts like central-
 * pond / twin pools intentionally have multiple water bodies, so we berm only
 * runs narrower than minRunCols and leave the rest alone.
 */
function killNoisePockets(
  terrain: number[],
  waterlineY: number,
  minRunCols: number,
): void {
  if (waterlineY <= 0) return;
  let start = -1;
  for (let x = 0; x <= terrain.length; x++) {
    const isWater = x < terrain.length && terrain[x] < waterlineY;
    if (isWater && start < 0) start = x;
    if (!isWater && start >= 0) {
      if (x - start < minRunCols) {
        for (let k = start; k < x; k++) terrain[k] = waterlineY + 1;
      }
      start = -1;
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
