import {
  computeLight,
  computeMoisture,
  computeZones,
  summarizeEnv,
} from "./fields";
import { placeHardscape } from "./hardscape";
import { buildMaterials } from "./materials";
import { generateTerrain } from "./terrain";
import { GEN_VERSION, archetypeOf, type TankState } from "./types";

export { GEN_VERSION, MATERIAL, ZONE, archetypeOf, cellIndex } from "./types";
export type {
  Archetype,
  HardscapePiece,
  MaterialId,
  TankState,
  ZoneId,
} from "./types";

export const TANK_WIDTH = 192;
export const TANK_HEIGHT = 108;
/** Glass headroom: the top of the tank is always air. */
const SKY_MARGIN = 0.15;

/**
 * Deterministic tank generation: same (seed, landPercent, GEN_VERSION) ⇒
 * byte-identical TankState. Pure function, runs once at new-game (<5ms).
 */
export function generateTank(
  seed: number,
  landPercent: number,
  width: number = TANK_WIDTH,
  height: number = TANK_HEIGHT,
): TankState {
  const normalizedSeed = seed >>> 0;
  const clampedLand = Math.min(100, Math.max(0, Math.round(landPercent)));
  const usableHeight = Math.floor(height * (1 - SKY_MARGIN));

  const { terrainHeight, waterlineY } = generateTerrain(
    normalizedSeed,
    clampedLand,
    width,
    usableHeight,
  );
  const materials = buildMaterials(
    terrainHeight,
    waterlineY,
    width,
    height,
    usableHeight,
    normalizedSeed,
  );
  // hardscape is cosmetic - drawn rotated along the slope by the renderer,
  // never stamped into the grid (an unrotated stamp punches holes in hills)
  const hardscape = placeHardscape(
    terrainHeight,
    waterlineY,
    width,
    usableHeight,
    normalizedSeed,
  );

  const light = computeLight(materials, width, height);
  const moisture = computeMoisture(
    materials,
    terrainHeight,
    waterlineY,
    width,
    height,
    clampedLand,
  );
  const zones = computeZones(materials, terrainHeight, waterlineY, width, height);
  const env = summarizeEnv(
    materials,
    light,
    moisture,
    terrainHeight,
    waterlineY,
    width,
    usableHeight,
  );

  return {
    genVersion: GEN_VERSION,
    seed: normalizedSeed,
    landPercent: clampedLand,
    archetype: archetypeOf(clampedLand),
    width,
    height,
    usableHeight,
    terrainHeight,
    waterlineY,
    materials,
    zones,
    light,
    moisture,
    hardscape,
    env,
  };
}
