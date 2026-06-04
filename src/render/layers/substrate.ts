import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import { valueNoise1D } from "../../sim/tankgen/noise";
import {
  MATERIAL,
  cellIndex,
  type HardscapePiece,
  type TankState,
} from "../../sim/tankgen";
import { SCENE } from "../palette";
import { columnWetness } from "../wetness";
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

  container.addChild(buildSurfaceHighlight(tank, layout));
  container.addChild(buildPebbles(tank, layout, rng));
  container.addChild(buildHardscapeShapes(tank, layout));
  return container;
}

/**
 * Rocks and driftwood drawn as shaded shapes over their stamped footprint —
 * volume instead of flat gray cell-bands.
 */
function buildHardscapeShapes(tank: TankState, layout: TankLayout): Graphics {
  const g = new Graphics();
  for (const piece of tank.hardscape) {
    if (piece.kind === "rock") {
      drawRock(g, layout, piece);
    } else {
      drawDriftwood(g, layout, piece);
    }
  }
  return g;
}

function drawRock(g: Graphics, layout: TankLayout, piece: HardscapePiece): void {
  const cx = screenX(layout, piece.x + 0.5);
  const cy = screenY(layout, piece.y);
  const rx = piece.halfWidth * layout.scale;
  const ry = piece.halfHeight * layout.scale;

  // soft contact shadow grounding the rock
  g.ellipse(cx, cy + ry * 0.75, rx * 0.95, ry * 0.3).fill({
    color: SCENE.soilDark,
    alpha: 0.3,
  });
  // body
  g.ellipse(cx, cy, rx, ry).fill(SCENE.rock);
  // lower shading
  g.ellipse(cx + rx * 0.06, cy + ry * 0.3, rx * 0.88, ry * 0.62).fill({
    color: SCENE.rockShadow,
    alpha: 0.45,
  });
  // top-left light
  g.ellipse(cx - rx * 0.28, cy - ry * 0.42, rx * 0.45, ry * 0.32).fill({
    color: 0xb9b4a8,
    alpha: 0.55,
  });
}

function drawDriftwood(
  g: Graphics,
  layout: TankLayout,
  piece: HardscapePiece,
): void {
  const cx = screenX(layout, piece.x + 0.5);
  const cy = screenY(layout, piece.y);
  const rx = piece.halfWidth * layout.scale;
  const ry = Math.max(piece.halfHeight * layout.scale, layout.scale * 1.1);

  g.ellipse(cx, cy + ry * 0.7, rx * 0.9, ry * 0.28).fill({
    color: SCENE.soilDark,
    alpha: 0.28,
  });
  g.roundRect(cx - rx, cy - ry * 0.55, rx * 2, ry * 1.1, ry * 0.5).fill(
    SCENE.wood,
  );
  // underside shading
  g.roundRect(cx - rx * 0.96, cy + ry * 0.05, rx * 1.92, ry * 0.45, ry * 0.25)
    .fill({ color: SCENE.woodDark, alpha: 0.6 });
  // grain lines
  for (let i = 0; i < 3; i++) {
    const ly = cy - ry * 0.3 + i * ry * 0.28;
    g.moveTo(cx - rx * (0.8 - i * 0.1), ly)
      .lineTo(cx + rx * (0.75 - i * 0.12), ly)
      .stroke({
        color: SCENE.woodDark,
        alpha: 0.5,
        width: Math.max(0.8, layout.scale * 0.12),
      });
  }
  // a worn end cap
  g.ellipse(cx + rx * 0.92, cy - ry * 0.05, ry * 0.32, ry * 0.4).fill({
    color: SCENE.woodDark,
    alpha: 0.8,
  });
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

/** Rock/wood cells are skipped here — drawn as shaded shapes on top. */
function isSolid(material: number): boolean {
  return (
    material !== MATERIAL.air &&
    material !== MATERIAL.water &&
    material !== MATERIAL.rock &&
    material !== MATERIAL.wood &&
    material >= 0
  );
}
