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

/** Blend two hex colors - wet shading fades smoothly along the bank. */
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

/** Multiply a hex color's brightness - cheap hand-painted value variation. */
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
    // low-frequency value variation - painterly patches, not corduroy
    const jitter = 0.96 + valueNoise1D(textureSeed, x * 0.13) * 0.08;
    drawColumn(g, tank, layout, x, jitter, wetness[x]);
  }
  container.addChild(g);

  container.addChild(buildTopFaces(tank, layout, wetness));
  container.addChild(buildPebbles(tank, layout, rng));
  container.addChild(buildHardscapeShapes(tank, layout));
  return container;
}

/**
 * The terrain's TOP FACE - a continuous lit ribbon following the surface
 * profile (steps included), receding by the same depth vector as the water
 * band and glass rim. Without it the 3D water surface met a flat 2D land
 * cutout at the shore and the projection visibly broke.
 */
function buildTopFaces(
  tank: TankState,
  layout: TankLayout,
  wetness: readonly number[],
): Graphics {
  const g = new Graphics();
  const maxX = layout.originX + layout.tankWidthPx;

  // contiguous runs of the same cap material fill as ONE ribbon segment
  let runStart = 0;
  let runCap = capMaterialAt(tank, 0);
  for (let x = 1; x <= tank.width; x++) {
    const cap = x < tank.width ? capMaterialAt(tank, x) : -1;
    if (cap !== runCap) {
      if (isSolid(runCap)) {
        fillTopRibbon(g, tank, layout, runStart, x, runCap, wetness, maxX);
      }
      runStart = x;
      runCap = cap;
    }
  }
  return g;
}

function capMaterialAt(tank: TankState, x: number): number {
  const surface = tank.terrainHeight[x];
  return tank.materials[cellIndex(tank.width, x, Math.max(0, surface - 1))];
}

function fillTopRibbon(
  g: Graphics,
  tank: TankState,
  layout: TankLayout,
  start: number,
  end: number,
  cap: number,
  wetness: readonly number[],
  maxX: number,
): void {
  const { depthX, depthY } = layout;
  // front edge: stepped terrain profile left → right
  const front: number[] = [];
  for (let x = start; x < end; x++) {
    const y = screenY(layout, tank.terrainHeight[x]);
    front.push(screenX(layout, x), y, screenX(layout, x + 1), y);
  }
  // back edge: same profile, receded - clamped inside the glass
  const back: number[] = [];
  for (let i = front.length - 2; i >= 0; i -= 2) {
    back.push(Math.min(maxX, front[i] + depthX), front[i + 1] + depthY);
  }

  let meanWetness = 0;
  for (let x = start; x < end; x++) meanWetness += wetness[x];
  meanWetness /= Math.max(1, end - start);

  g.poly([...front, ...back]).fill(
    shade(fillFor(cap, meanWetness), 1.18),
  );
}

/**
 * Driftwood drawn as shaded logs LYING ALONG the bank - each piece is its
 * own Graphics rotated to the local terrain slope.
 */
function buildHardscapeShapes(tank: TankState, layout: TankLayout): Container {
  const container = new Container();
  for (const piece of tank.hardscape) {
    if (piece.kind === "driftwood") {
      container.addChild(buildDriftwood(layout, piece));
    }
  }
  return container;
}

function buildDriftwood(
  layout: TankLayout,
  piece: HardscapePiece,
): Graphics {
  const g = new Graphics();
  const rx = piece.halfWidth * layout.scale;
  const ry = Math.max(piece.halfHeight * layout.scale, layout.scale * 1.1);
  const flip = piece.x % 2 === 0 ? 1 : -1; // mirror variety per placement

  // soft contact shadow
  g.ellipse(0, ry * 0.55, rx * 0.92, ry * 0.3).fill({
    color: SCENE.soilDark,
    alpha: 0.28,
  });

  // trunk: a tapered organic body (fat end → thin end), not a plank
  const trunk: number[] = [];
  const SEGMENTS = 10;
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const px = (-rx + t * 2 * rx) * flip;
    const thickness = ry * (0.62 - t * 0.22) * (1 + Math.sin(t * 9) * 0.07);
    trunk.push(px, -thickness);
  }
  for (let i = SEGMENTS; i >= 0; i--) {
    const t = i / SEGMENTS;
    const px = (-rx + t * 2 * rx) * flip;
    const thickness = ry * (0.62 - t * 0.22) * (1 + Math.cos(t * 7) * 0.06);
    trunk.push(px, thickness * 0.75);
  }
  g.poly(trunk).fill(SCENE.wood);

  // a broken branch stub reaching up from the fat end
  const stubX = -rx * 0.45 * flip;
  g.poly([
    stubX, -ry * 0.4,
    stubX + ry * 0.55 * flip, -ry * 1.5,
    stubX + ry * 0.95 * flip, -ry * 1.35,
    stubX + ry * 0.5 * flip, -ry * 0.25,
  ]).fill(SCENE.wood);
  g.ellipse(stubX + ry * 0.72 * flip, -ry * 1.4, ry * 0.18, ry * 0.12).fill({
    color: SCENE.woodDark,
    alpha: 0.85,
  });

  // underside in shadow
  g.poly([
    -rx * flip, 0,
    rx * flip, ry * 0.1,
    rx * 0.95 * flip, ry * 0.42,
    -rx * 0.95 * flip, ry * 0.5,
  ]).fill({ color: SCENE.woodDark, alpha: 0.55 });

  // cut-ring on the fat end
  g.ellipse(-rx * 0.97 * flip, -ry * 0.05, ry * 0.22, ry * 0.45).fill(
    SCENE.woodDark,
  );
  g.ellipse(-rx * 0.97 * flip, -ry * 0.05, ry * 0.1, ry * 0.22).fill({
    color: SCENE.wood,
    alpha: 0.7,
  });

  // moss settling on the upper side - an old log belongs to the scene
  g.ellipse(-rx * 0.15 * flip, -ry * 0.55, rx * 0.2, ry * 0.28).fill({
    color: SCENE.moss,
    alpha: 0.85,
  });
  g.ellipse(rx * 0.3 * flip, -ry * 0.42, rx * 0.13, ry * 0.2).fill({
    color: SCENE.leafLight,
    alpha: 0.5,
  });

  // rests level on flat ground (placement guarantees flatness)
  g.position.set(screenX(layout, piece.x + 0.5), screenY(layout, piece.y));
  return g;
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

/** Rock/wood cells are skipped here - drawn as shaded shapes on top. */
function isSolid(material: number): boolean {
  return (
    material !== MATERIAL.air &&
    material !== MATERIAL.water &&
    material !== MATERIAL.rock &&
    material !== MATERIAL.wood &&
    material >= 0
  );
}
