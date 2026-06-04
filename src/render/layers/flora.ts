import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import type { SimState } from "../../sim/types";
import { ZONE, cellIndex, type TankState } from "../../sim/tankgen";
import { SCENE } from "../palette";
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

interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly variant: number;
  /** scalar value at which this anchor becomes visible */
  readonly threshold: number;
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

  let lastSim: SimState | null = null;
  let swayPhase = 0;

  const update = (sim: SimState): void => {
    lastSim = sim;
    drawMicrobes(microbeGfx, tank, layout, speckSeeds, sim, swayPhase);
    drawAlgae(algaeGfx, tank, layout, algaeAnchors, sim.scalars.algae);
    drawPlants(plantGfx, layout, plantAnchors, sim.scalars.plants, swayPhase);
  };

  const tick = (timeMs: number): void => {
    swayPhase = timeMs / 1000;
    if (!lastSim) return;
    drawMicrobes(microbeGfx, tank, layout, speckSeeds, lastSim, swayPhase);
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
  }));
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
  sim: SimState,
  phase: number,
): void {
  g.clear();
  const strength = sim.scalars.microbes;
  if (strength <= 0.01) return;

  // living film along the substrate surface — the "it's alive" shimmer
  const filmAlpha = Math.min(0.5, strength * 0.55);
  for (let x = 0; x < tank.width - 1; x += 2) {
    const y = screenY(layout, tank.terrainHeight[x] + 0.2);
    g.rect(
      screenX(layout, x),
      y,
      layout.scale * 2,
      layout.scale * 0.55,
    ).fill({ color: SCENE.microbeGlow, alpha: filmAlpha });
  }

  // drifting motes in the water — the first visible sign of life
  const visible = Math.floor(specks.length * Math.min(1, strength * 1.6));
  const moteAlpha = Math.min(0.65, 0.2 + strength * 0.45);
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
    drawSprout(g, layout, anchor, growth, sway);
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
