import { mulberry32, splitSeed } from "../rng";
import { STREAMS } from "./terrain";
import { MATERIAL, cellIndex } from "./types";

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

  for (let x = 0; x < width; x++) {
    const surface = terrain[x];
    const isLand = surface >= waterlineY;
    const drainage = 2 + (isLand ? 1 : 0) + (rng() < 0.5 ? 1 : 0);
    const capThickness = 1 + (rng() < 0.35 ? 1 : 0);
    const cap: number =
      surface < waterlineY
        ? MATERIAL.sand
        : surface > waterlineY + 1
          ? MATERIAL.litter
          : MATERIAL.sand;

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
