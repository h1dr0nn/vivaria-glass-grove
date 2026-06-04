import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import { valueNoise1D } from "../../sim/tankgen/noise";
import { MATERIAL, cellIndex, type TankState } from "../../sim/tankgen";
import { SCENE } from "../palette";
import { screenX, screenY, type TankLayout } from "../layout";

const MATERIAL_FILL: Partial<Record<number, number>> = {
  [MATERIAL.drainage]: SCENE.drainage,
  [MATERIAL.soil]: SCENE.soil,
  [MATERIAL.sand]: SCENE.sand,
  [MATERIAL.litter]: SCENE.litter,
  [MATERIAL.rock]: SCENE.rock,
  [MATERIAL.wood]: SCENE.wood,
};

const TEXTURE_STREAM = 20;

/** Blend two hex colors — wet shading fades smoothly along the bank. */
function mixColor(a: number, b: number, t: number): number {
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * t);
  return (
    (mix((a >> 16) & 0xff, (b >> 16) & 0xff) << 16) |
    (mix((a >> 8) & 0xff, (b >> 8) & 0xff) << 8) |
    mix(a & 0xff, b & 0xff)
  );
}

/** Wet sand/soil darken proportionally to how damp the column is. */
function fillFor(material: number, wetness: number): number {
  if (material === MATERIAL.sand) {
    return mixColor(SCENE.sand, SCENE.sandWet, wetness);
  }
  if (material === MATERIAL.soil) {
    return mixColor(SCENE.soil, SCENE.soilDark, wetness);
  }
  return MATERIAL_FILL[material] ?? SCENE.soil;
}

/** Multiply a hex color's brightness — cheap hand-painted value variation. */
function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/**
 * 1 for submerged columns, fading to 0 over a few columns of dry bank —
 * the shoreline reads damp instead of cutting a hard vertical seam.
 */
function columnWetness(tank: TankState): number[] {
  const { width, terrainHeight, waterlineY } = tank;
  const wetness = new Array<number>(width).fill(0);
  // distance (in columns) to the nearest submerged column
  let last = Number.POSITIVE_INFINITY;
  const dist = new Array<number>(width).fill(Number.POSITIVE_INFINITY);
  for (let x = 0; x < width; x++) {
    last = terrainHeight[x] < waterlineY ? 0 : last + 1;
    dist[x] = Math.min(dist[x], last);
  }
  last = Number.POSITIVE_INFINITY;
  for (let x = width - 1; x >= 0; x--) {
    last = terrainHeight[x] < waterlineY ? 0 : last + 1;
    dist[x] = Math.min(dist[x], last);
  }
  for (let x = 0; x < width; x++) {
    wetness[x] = dist[x] === 0 ? 1 : Math.max(0, 0.75 - dist[x] * 0.15);
  }
  return wetness;
}

/**
 * Terrain cross-section as per-column material runs, split at the waterline
 * so wet and dry soil read differently. Per-column value jitter plus seeded
 * pebble speckles break up the flat masses. Built once per tank.
 */
export function buildSubstrate(tank: TankState, layout: TankLayout): Container {
  const container = new Container();
  const g = new Graphics();
  const rng = mulberry32(splitSeed(tank.seed, TEXTURE_STREAM));

  const textureSeed = splitSeed(tank.seed, TEXTURE_STREAM) ^ 0x1b873593;
  const wetness = columnWetness(tank);
  for (let x = 0; x < tank.width; x++) {
    // low-frequency value variation — painterly patches, not corduroy
    const jitter = 0.96 + valueNoise1D(textureSeed, x * 0.13) * 0.08;
    drawColumn(g, tank, layout, x, jitter, wetness[x]);
  }
  container.addChild(g);

  container.addChild(buildPebbles(tank, layout, rng));
  container.addChild(buildSurfaceHighlight(tank, layout));
  return container;
}

function drawColumn(
  g: Graphics,
  tank: TankState,
  layout: TankLayout,
  x: number,
  jitter: number,
  wetness: number,
): void {
  let runStart = 0;
  let runMaterial = tank.materials[cellIndex(tank.width, x, 0)];

  const flush = (end: number): void => {
    if (!isSolid(runMaterial)) return;
    g.rect(
      screenX(layout, x),
      screenY(layout, end),
      layout.scale + 0.5,
      (end - runStart) * layout.scale + 0.5,
    ).fill(shade(fillFor(runMaterial, wetness), jitter));
  };

  for (let y = 1; y <= tank.height; y++) {
    const material =
      y < tank.height ? tank.materials[cellIndex(tank.width, x, y)] : -1;
    if (material !== runMaterial) {
      flush(y);
      runStart = y;
      runMaterial = material;
    }
  }
}

/** Scattered pebbles and darker grains inside the soil mass. */
function buildPebbles(
  tank: TankState,
  layout: TankLayout,
  rng: () => number,
): Graphics {
  const g = new Graphics();
  const count = Math.floor(tank.width * 0.9);
  for (let i = 0; i < count; i++) {
    const x = rng() * tank.width;
    const column = Math.min(tank.width - 1, Math.floor(x));
    const surface = tank.terrainHeight[column];
    if (surface < 6) continue;
    const y = 2 + rng() * (surface - 4);
    const wet = surface < tank.waterlineY;
    const size = layout.scale * (0.25 + rng() * 0.5);
    const tone = rng();
    const color =
      tone < 0.45
        ? shade(wet ? SCENE.soilDark : SCENE.soil, 0.78)
        : tone < 0.8
          ? SCENE.drainageDark
          : shade(wet ? SCENE.sandWet : SCENE.sand, 0.92);
    g.circle(screenX(layout, x), screenY(layout, y), size).fill({
      color,
      alpha: 0.5,
    });
  }
  return g;
}

/** Gentle highlight tracing the terrain surface — softens cell edges. */
function buildSurfaceHighlight(tank: TankState, layout: TankLayout): Graphics {
  const surface = new Graphics();
  let penDown = false;
  for (let x = 0; x < tank.width; x++) {
    const h = tank.terrainHeight[x];
    const px = screenX(layout, x) + layout.scale / 2;
    const py = screenY(layout, h);
    if (!penDown) {
      surface.moveTo(px, py);
      penDown = true;
    } else {
      surface.lineTo(px, py);
    }
  }
  surface.stroke({
    color: 0xf2e7c8,
    alpha: 0.28,
    width: Math.max(1, layout.scale * 0.35),
  });
  return surface;
}

function isSolid(material: number): boolean {
  return (
    material !== MATERIAL.air && material !== MATERIAL.water && material >= 0
  );
}
