import { mulberry32, splitSeed } from "../rng";
import { STREAMS } from "./terrain";
import { MATERIAL, cellIndex } from "./types";

/** horizontal distance (columns) to the nearest submerged column */
function distanceToWater(
  terrain: readonly number[],
  waterlineY: number,
  width: number,
): number[] {
  const dist = new Array<number>(width).fill(Number.POSITIVE_INFINITY);
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

/**
 * STEP 3 — substrate layering per column, bottom-up, mirroring a real
 * bioactive stack: drainage (false bottom) → soil → cap. Submerged and shore
 * columns get a SAND cap (keeps the water clear); dry land gets LEAF LITTER
 * (the food store that succession will decompose).
 */
export function buildMaterials(
  terrain: readonly number[],
  waterlineY: number,
  width: number,
  height: number,
  usableHeight: number,
  seed: number,
): Uint8Array {
  const rng = mulberry32(splitSeed(seed, STREAMS.substrate));
  const materials = new Uint8Array(width * height); // defaults to air (0)
  const beachDist = distanceToWater(terrain, waterlineY, width);

  for (let x = 0; x < width; x++) {
    const surface = terrain[x];
    const isLand = surface >= waterlineY;
    // ONE uniform drainage band — a land/water thickness difference put a
    // visible 1-cell notch exactly at the shore crossing
    const drainage = 2;
    const capThickness = isLand ? 2 : 1;
    void rng; // reserved for future substrate variation
    // sand only underwater and on the BEACH hugging the water's edge —
    // a pale sand shelf high on the slope reads as a rendering glitch
    const isBeach = beachDist[x] <= 3 && surface <= waterlineY + 3;
    const cap: number =
      surface < waterlineY || isBeach ? MATERIAL.sand : MATERIAL.litter;

    for (let y = 0; y < height; y++) {
      const i = cellIndex(width, x, y);
      if (y < surface) {
        if (y < Math.min(drainage, surface - 1)) {
          materials[i] = MATERIAL.drainage;
        } else if (y >= surface - capThickness) {
          materials[i] = cap;
        } else {
          materials[i] = MATERIAL.soil;
        }
      } else if (y < waterlineY && y < usableHeight) {
        materials[i] = MATERIAL.water;
      } else {
        materials[i] = MATERIAL.air;
      }
    }
  }
  return materials;
}
