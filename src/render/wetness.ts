import type { TankState } from "../sim/tankgen";

/**
 * 1 for submerged columns, fading to 0 over a few columns of dry bank.
 * Shared by substrate shading and the microbial film placement.
 */
export function columnWetness(tank: TankState): number[] {
  const { width, terrainHeight, waterlineY } = tank;
  const dist = new Array<number>(width).fill(Number.POSITIVE_INFINITY);
  let last = Number.POSITIVE_INFINITY;
  for (let x = 0; x < width; x++) {
    last = terrainHeight[x] < waterlineY ? 0 : last + 1;
    dist[x] = Math.min(dist[x], last);
  }
  last = Number.POSITIVE_INFINITY;
  for (let x = width - 1; x >= 0; x--) {
    last = terrainHeight[x] < waterlineY ? 0 : last + 1;
    dist[x] = Math.min(dist[x], last);
  }
  return dist.map((d) => (d === 0 ? 1 : Math.max(0, 0.75 - d * 0.15)));
}
