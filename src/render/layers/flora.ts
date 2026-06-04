import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import type { SimState } from "../../sim/types";
import { ZONE, cellIndex, type TankState } from "../../sim/tankgen";
import { SCENE } from "../palette";
import { columnWetness } from "../wetness";
import { screenX, screenY, type TankLayout } from "../layout";

/**
 * Life, drawn from the sim's scalars. Anchor positions are seeded and fixed;
 * each anchor wakes up as its tier's scalar passes a staggered threshold, so
 * growth spreads organically instead of fading in everywhere at once.
 */

const ANCHOR_STREAM = { algae: 10, plants: 11, microbes: 12 } as const;
const MAX_ALGAE_TUFTS = 22;
const MAX_PLANTS = 16;
const MICROBE_SPECKS = 36;

type PlantKind = "aquatic" | "fern" | "moss";

interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly variant: number;
  /** scalar value at which this anchor becomes visible */
  readonly threshold: number;
  readonly kind: PlantKind;
}

export interface FloraLayer {
  readonly container: Container;
  /** redraw growth to match the sim — call on sim updates, not per frame */
  update(sim: SimState): void;
  /** ambient sway/drift at a given time — call from the visible-only ticker */
  tick(timeMs: number): void;
}

export function buildFlora(tank: TankState, layout: TankLayout): FloraLayer {
  const container = new Container();

  const microbeGfx = new Graphics();
  const algaeGfx = new Graphics();
  const plantGfx = new Graphics();
  container.addChild(microbeGfx, algaeGfx, plantGfx);

  const algaeAnchors = pickAnchors(
    tank,
    splitSeed(tank.seed, ANCHOR_STREAM.algae),
    MAX_ALGAE_TUFTS,
    isUnderwaterSurface,
  );
  const plantAnchors = pickAnchors(
    tank,
    splitSeed(tank.seed, ANCHOR_STREAM.plants),
    MAX_PLANTS,
    isPlantableSurface,
  );
  const speckSeeds = makeSpecks(tank, splitSeed(tank.seed, ANCHOR_STREAM.microbes));
  const wetness = columnWetness(tank);

  let lastSim: SimState | null = null;
  let swayPhase = 0;

  const update = (sim: SimState): void => {
    lastSim = sim;
    drawMicrobes(microbeGfx, tank, layout, speckSeeds, wetness, sim, swayPhase);
    drawAlgae(algaeGfx, tank, layout, algaeAnchors, sim.scalars.algae);
    drawPlants(plantGfx, layout, plantAnchors, sim.scalars.plants, swayPhase);
  };

  const tick = (timeMs: number): void => {
    swayPhase = timeMs / 1000;
    if (!lastSim) return;
    drawMicrobes(microbeGfx, tank, layout, speckSeeds, wetness, lastSim, swayPhase);
    drawPlants(plantGfx, layout, plantAnchors, lastSim.scalars.plants, swayPhase);
  };

  return { container, update, tick };
}

// ---------------------------------------------------------------- anchors

function pickAnchors(
  tank: TankState,
  seed: number,
  max: number,
  accept: (tank: TankState, x: number) => boolean,
): Anchor[] {
  const rng = mulberry32(seed);
  const candidates: number[] = [];
  for (let x = 2; x < tank.width - 2; x++) {
    if (accept(tank, x)) candidates.push(x);
  }
  // seeded shuffle, take up to max
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked = candidates.slice(0, max);
  return picked.map((x, i) => ({
    x,
    y: tank.terrainHeight[x],
    variant: Math.floor(rng() * 1000),
    threshold: (i + 0.5) / max,
    kind: plantKindAt(tank, x),
  }));
}

/** What grows here: waterweed below the line, ferns low, moss up high. */
function plantKindAt(tank: TankState, x: number): PlantKind {
  if (isUnderwaterSurface(tank, x)) return "aquatic";
  const zone = tank.zones[cellIndex(tank.width, x, tank.terrainHeight[x])];
  if (zone === ZONE.highland) return "moss";
  if (zone === ZONE.midland) return ((x % 2) === 0 ? "fern" : "moss");
  return "fern";
}

function isUnderwaterSurface(tank: TankState, x: number): boolean {
  return tank.terrainHeight[x] < tank.waterlineY;
}

function isPlantableSurface(tank: TankState, x: number): boolean {
  const zone = tank.zones[cellIndex(tank.width, x, tank.terrainHeight[x])];
  return (
    zone === ZONE.shore ||
    zone === ZONE.lowland ||
    zone === ZONE.midland ||
    zone === ZONE.highland ||
    isUnderwaterSurface(tank, x)
  );
}

// ---------------------------------------------------------------- microbes

interface Speck {
  readonly x: number;
  readonly y: number;
  readonly phase: number;
}

function makeSpecks(tank: TankState, seed: number): Speck[] {
  const rng = mulberry32(seed);
  const specks: Speck[] = [];
  if (tank.waterlineY <= 2) return specks;
  for (let i = 0; i < MICROBE_SPECKS; i++) {
    const x = 3 + rng() * (tank.width - 6);
    const depth = rng();
    const column = Math.floor(x);
    const floor = tank.terrainHeight[column];
    if (floor >= tank.waterlineY - 1) continue;
    specks.push({
      x,
      y: floor + 1 + depth * (tank.waterlineY - floor - 2),
      phase: rng() * Math.PI * 2,
    });
  }
  return specks;
}

function drawMicrobes(
  g: Graphics,
  tank: TankState,
  layout: TankLayout,
  specks: readonly Speck[],
  wetness: readonly number[],
  sim: SimState,
  phase: number,
): void {
  g.clear();
  const strength = sim.scalars.microbes;
  if (strength <= 0.01) return;

  // The "it's alive" shimmer: a soft film hugging DAMP substrate only,
  // handing the stage to algae as the bloom takes over (never a permanent
  // gray overlay on dry land).
  const handoff = Math.max(0, 1 - sim.scalars.algae * 1.4);
  const filmAlpha = Math.min(0.3, strength * 0.45) * handoff;
  if (filmAlpha > 0.02) {
    let penDown = false;
    for (let x = 0; x < tank.width; x++) {
      if (wetness[x] < 0.4) {
        penDown = false;
        continue;
      }
      const px = screenX(layout, x) + layout.scale / 2;
      const py = screenY(layout, tank.terrainHeight[x] + 0.25);
      if (!penDown) {
        g.moveTo(px, py);
        penDown = true;
      } else {
        g.lineTo(px, py);
      }
    }
    g.stroke({
      color: SCENE.microbeGlow,
      alpha: filmAlpha,
      width: Math.max(1, layout.scale * 0.45),
    });
  }

  // drifting motes in the water — fade as larger life takes the scene
  const moteFade = Math.max(0.25, 1 - sim.scalars.algae * 0.6);
  const visible = Math.floor(
    specks.length * Math.min(1, strength * 1.6) * moteFade,
  );
  const moteAlpha = Math.min(0.55, 0.18 + strength * 0.4) * moteFade;
  for (let i = 0; i < visible; i++) {
    const speck = specks[i];
    const drift = Math.sin(phase * 0.5 + speck.phase) * 0.4;
    const bob = Math.cos(phase * 0.35 + speck.phase * 1.7) * 0.3;
    g.circle(
      screenX(layout, speck.x + drift),
      screenY(layout, speck.y + bob),
      Math.max(1, layout.scale * 0.22),
    ).fill({ color: SCENE.microbeGlow, alpha: moteAlpha });
  }
}

// ---------------------------------------------------------------- algae

function drawAlgae(
  g: Graphics,
  tank: TankState,
  layout: TankLayout,
  anchors: readonly Anchor[],
  algae: number,
): void {
  g.clear();
  if (algae <= 0.005) return;

  // green film over submerged surfaces
  const filmAlpha = Math.min(0.5, algae * 0.55);
  for (let x = 0; x < tank.width - 1; x++) {
    if (!isUnderwaterSurface(tank, x)) continue;
    const y = screenY(layout, tank.terrainHeight[x] + 0.3);
    g.rect(
      screenX(layout, x),
      y,
      layout.scale + 0.5,
      layout.scale * 0.5,
    ).fill({ color: SCENE.algae, alpha: filmAlpha });
  }

  // tufts wake up one by one as the bloom spreads
  for (const anchor of anchors) {
    const growth = staggeredGrowth(algae, anchor.threshold);
    if (growth <= 0) continue;
    const cx = screenX(layout, anchor.x + 0.5);
    const cy = screenY(layout, anchor.y + 0.2);
    const size = layout.scale * (1 + growth * 3.6) * (0.75 + (anchor.variant % 4) * 0.12);
    const blades = 3 + (anchor.variant % 4);
    for (let b = 0; b < blades; b++) {
      const lean = (b / (blades - 1) - 0.5) * 1.7;
      g.moveTo(cx, cy)
        .quadraticCurveTo(
          cx + lean * size * 0.5,
          cy - size * 0.6,
          cx + lean * size,
          cy - size,
        )
        .stroke({
          color: b % 2 === 0 ? SCENE.algae : SCENE.algaeDeep,
          alpha: 0.9,
          width: Math.max(1.2, layout.scale * 0.4),
        });
    }
  }
}

// ---------------------------------------------------------------- plants

function drawPlants(
  g: Graphics,
  layout: TankLayout,
  anchors: readonly Anchor[],
  plants: number,
  phase: number,
): void {
  g.clear();
  if (plants <= 0.005) return;

  for (const anchor of anchors) {
    const growth = staggeredGrowth(plants, anchor.threshold);
    if (growth <= 0) continue;
    const sway = Math.sin(phase * 0.8 + anchor.variant) * 0.12 * growth;
    switch (anchor.kind) {
      case "fern":
        drawFern(g, layout, anchor, growth, sway);
        break;
      case "moss":
        drawMossCushion(g, layout, anchor, growth);
        break;
      default:
        drawSprout(g, layout, anchor, growth, sway);
        break;
    }
  }
}

/** Arched fronds with leaflets — the forest-floor look. */
function drawFern(
  g: Graphics,
  layout: TankLayout,
  anchor: Anchor,
  growth: number,
  sway: number,
): void {
  const baseX = screenX(layout, anchor.x + 0.5);
  const baseY = screenY(layout, anchor.y);
  const fronds = 2 + (anchor.variant % 3);
  const reach = layout.scale * (1.2 + growth * 7) * (0.8 + (anchor.variant % 4) * 0.1);

  for (let f = 0; f < fronds; f++) {
    const lean = (f / Math.max(1, fronds - 1) - 0.5) * 1.8 + sway * 2;
    const tipX = baseX + lean * reach * 0.55;
    const tipY = baseY - reach * (0.75 + (f % 2) * 0.2);
    g.moveTo(baseX, baseY)
      .quadraticCurveTo(baseX + lean * reach * 0.15, baseY - reach * 0.6, tipX, tipY)
      .stroke({
        color: SCENE.stem,
        alpha: 0.9,
        width: Math.max(1, layout.scale * 0.22),
      });
    const leaflets = 2 + Math.floor(growth * 4);
    for (let l = 1; l <= leaflets; l++) {
      const t = l / (leaflets + 1);
      const lx = baseX + (tipX - baseX) * t;
      const ly = baseY + (tipY - baseY) * t - reach * 0.1 * Math.sin(t * Math.PI);
      const size = layout.scale * (0.55 + growth * 0.7) * (1 - t * 0.45);
      g.ellipse(lx - size * 0.5, ly, size, size * 0.32).fill({
        color: SCENE.leaf,
        alpha: 0.9,
      });
      g.ellipse(lx + size * 0.5, ly, size, size * 0.32).fill({
        color: SCENE.leafLight,
        alpha: 0.9,
      });
    }
  }
}

/** A soft green dome with tiny spore stalks — the highland look. */
function drawMossCushion(
  g: Graphics,
  layout: TankLayout,
  anchor: Anchor,
  growth: number,
): void {
  const baseX = screenX(layout, anchor.x + 0.5);
  const baseY = screenY(layout, anchor.y);
  const width = layout.scale * (1.4 + growth * 3.4);
  const height = layout.scale * (0.6 + growth * 1.3);

  g.ellipse(baseX, baseY - height * 0.3, width, height).fill({
    color: SCENE.moss,
    alpha: 0.95,
  });
  g.ellipse(baseX - width * 0.25, baseY - height * 0.55, width * 0.5, height * 0.5).fill({
    color: SCENE.leafLight,
    alpha: 0.5,
  });
  // spore stalks rise from a mature cushion
  if (growth > 0.5) {
    const stalks = 1 + (anchor.variant % 3);
    for (let s = 0; s < stalks; s++) {
      const sx = baseX + (s - stalks / 2) * width * 0.4;
      const sh = height * (1.6 + (s % 2) * 0.5);
      g.moveTo(sx, baseY - height * 0.5)
        .lineTo(sx, baseY - height * 0.5 - sh)
        .stroke({
          color: SCENE.algaeDeep,
          alpha: 0.8,
          width: Math.max(0.8, layout.scale * 0.12),
        });
      g.circle(sx, baseY - height * 0.5 - sh, layout.scale * 0.18).fill({
        color: 0xc9a86a,
        alpha: 0.9,
      });
    }
  }
}

function drawSprout(
  g: Graphics,
  layout: TankLayout,
  anchor: Anchor,
  growth: number,
  sway: number,
): void {
  const baseX = screenX(layout, anchor.x + 0.5);
  const baseY = screenY(layout, anchor.y);
  const height =
    layout.scale * (1.5 + growth * 12) * (0.75 + (anchor.variant % 5) * 0.12);
  const tipX = baseX + sway * height;
  const tipY = baseY - height;

  g.moveTo(baseX, baseY)
    .quadraticCurveTo(
      baseX + sway * height * 0.4,
      baseY - height * 0.55,
      tipX,
      tipY,
    )
    .stroke({
      color: SCENE.stem,
      alpha: 0.95,
      width: Math.max(1.4, layout.scale * 0.45 * (0.6 + growth * 0.7)),
    });

  const leaves = 1 + Math.floor(growth * 5);
  for (let l = 0; l < leaves; l++) {
    const t = (l + 1) / (leaves + 1);
    const lx = baseX + (tipX - baseX) * t;
    const ly = baseY + (tipY - baseY) * t;
    const side = l % 2 === 0 ? 1 : -1;
    const leafSize = layout.scale * (0.8 + growth * 1.7) * (1 - t * 0.35);
    g.ellipse(lx + side * leafSize * 0.75, ly, leafSize, leafSize * 0.42).fill({
      color: l % 2 === 0 ? SCENE.leaf : SCENE.leafLight,
      alpha: 0.92,
    });
  }

  // a mature plant carries a tiny warm blossom at the tip
  if (growth > 0.75 && anchor.variant % 3 === 0) {
    g.circle(tipX, tipY, layout.scale * 0.55).fill({
      color: 0xe8b85c,
      alpha: 0.95,
    });
  }
}

/** 0 until the threshold, then eases to 1 as the scalar continues past it. */
function staggeredGrowth(scalar: number, threshold: number): number {
  if (scalar < threshold) return 0;
  return Math.min(1, ((scalar - threshold) / (1 - threshold)) * 1.6);
}
