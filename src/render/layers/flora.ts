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

const ANCHOR_STREAM = {
  algae: 10,
  plants: 11,
  microbes: 12,
  tree: 13,
  lily: 14,
} as const;
const MAX_ALGAE_TUFTS = 22;
const MAX_PLANTS = 16;
const MICROBE_SPECKS = 36;
const MAX_LILIES = 8;
/** the bonsai is the late-game payoff: sapling from 0.5, full tree at 0.85+ */
const TREE_START = 0.5;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

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
  /** redraw growth to match the sim - call on sim updates, not per frame */
  update(sim: SimState): void;
  /** ambient sway/drift at a given time - call from the visible-only ticker */
  tick(timeMs: number): void;
}

export function buildFlora(tank: TankState, layout: TankLayout): FloraLayer {
  const container = new Container();

  const microbeGfx = new Graphics();
  const algaeGfx = new Graphics();
  const treeGfx = new Graphics(); // behind small plants - ferns overlap the trunk base
  const plantGfx = new Graphics();
  const lilyGfx = new Graphics(); // floats above everything in the flora layer
  container.addChild(microbeGfx, algaeGfx, treeGfx, plantGfx, lilyGfx);

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
  const treeAnchors = pickTreeAnchors(
    tank,
    splitSeed(tank.seed, ANCHOR_STREAM.tree),
  );
  const lilyAnchors = pickLilyAnchors(
    tank,
    splitSeed(tank.seed, ANCHOR_STREAM.lily),
  );

  let lastSim: SimState | null = null;
  let swayPhase = 0;

  const update = (sim: SimState): void => {
    lastSim = sim;
    drawMicrobes(microbeGfx, tank, layout, speckSeeds, wetness, sim, swayPhase);
    drawAlgae(algaeGfx, tank, layout, algaeAnchors, sim.scalars.algae);
    drawTrees(treeGfx, layout, treeAnchors, sim.scalars.plants, swayPhase);
    drawPlants(plantGfx, layout, plantAnchors, sim.scalars.plants, swayPhase);
    drawLilies(lilyGfx, tank, layout, lilyAnchors, sim.scalars.algae, swayPhase);
  };

  const tick = (timeMs: number): void => {
    swayPhase = timeMs / 1000;
    if (!lastSim) return;
    drawMicrobes(microbeGfx, tank, layout, speckSeeds, wetness, lastSim, swayPhase);
    drawTrees(treeGfx, layout, treeAnchors, lastSim.scalars.plants, swayPhase);
    drawPlants(plantGfx, layout, plantAnchors, lastSim.scalars.plants, swayPhase);
    drawLilies(
      lilyGfx,
      tank,
      layout,
      lilyAnchors,
      lastSim.scalars.algae,
      swayPhase,
    );
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

  // drifting motes in the water - fade as larger life takes the scene
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

/** Arched fronds with leaflets - the forest-floor look. */
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

/**
 * A proper moss MOUND - domed, stippled, hugging the ground. (The old flat
 * ellipse read as a lily pad sitting on dirt - user confusion.)
 */
function drawMossCushion(
  g: Graphics,
  layout: TankLayout,
  anchor: Anchor,
  growth: number,
): void {
  const baseX = screenX(layout, anchor.x + 0.5);
  const baseY = screenY(layout, anchor.y + 0.05);
  const width = layout.scale * (1.1 + growth * 2.1);
  const height = width * (0.5 + (anchor.variant % 3) * 0.09);

  // a true MOUND: arched top, FLAT base merging into the ground -
  // a full ellipse painted over the dirt reads as a floating pad
  const SAMPLES = 10;
  const arch: number[] = [baseX - width, baseY];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const bump = Math.sin(t * Math.PI) ** 0.8;
    const lobe =
      0.82 +
      0.18 * Math.sin(t * 7 + anchor.variant) *
        Math.sin(t * 3.3 + anchor.variant * 1.7);
    arch.push(baseX - width + t * 2 * width, baseY - height * bump * lobe);
  }
  arch.push(baseX + width, baseY);
  g.poly(arch).fill(SCENE.moss);
  // shaded right flank + lit crown
  g.poly([
    baseX, baseY,
    baseX + width * 0.2, baseY - height * 0.78,
    baseX + width * 0.62, baseY - height * 0.5,
    baseX + width, baseY,
  ]).fill({ color: SCENE.algaeDeep, alpha: 0.55 });
  g.ellipse(
    baseX - width * 0.25,
    baseY - height * 0.68,
    width * 0.34,
    height * 0.18,
  ).fill({ color: SCENE.leafLight, alpha: 0.5 });
  // stipple - tiny tufts that say "moss", not "leaf"
  for (let d = 0; d < 5; d++) {
    const dx = Math.sin(anchor.variant * 3.7 + d * 2.4) * width * 0.55;
    const t = Math.abs(dx) / width;
    const dy = -height * Math.sin(Math.min(1, 1 - t) * Math.PI * 0.5) * (0.35 + ((anchor.variant + d) % 3) * 0.15);
    g.circle(baseX + dx, baseY + dy, layout.scale * 0.12).fill({
      color: d % 2 === 0 ? SCENE.leafLight : SCENE.algaeDeep,
      alpha: 0.6,
    });
  }
  // spore stalks rise from a mature cushion
  if (growth > 0.5) {
    const stalks = 1 + (anchor.variant % 3);
    for (let s = 0; s < stalks; s++) {
      const sx = baseX + (s - stalks / 2) * width * 0.45;
      const sh = height * (0.9 + (s % 2) * 0.3);
      g.moveTo(sx, baseY - height * 0.45)
        .lineTo(sx, baseY - height * 0.45 - sh)
        .stroke({
          color: SCENE.algaeDeep,
          alpha: 0.8,
          width: Math.max(0.8, layout.scale * 0.12),
        });
      g.circle(sx, baseY - height * 0.45 - sh, layout.scale * 0.16).fill({
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

// ------------------------------------------------------------------ tree

interface TreeAnchor {
  readonly x: number;
  readonly y: number;
  readonly variant: number;
}

/** 1 (rarely 2) flat, high, dry spots away from the glass - the tree sites. */
function pickTreeAnchors(tank: TankState, seed: number): TreeAnchor[] {
  if (tank.landPercent < 25) return [];
  const rng = mulberry32(seed);
  const margin = Math.max(4, Math.floor(tank.width * 0.08));
  const candidates: number[] = [];
  for (let x = margin; x < tank.width - margin; x++) {
    const zone = tank.zones[cellIndex(tank.width, x, tank.terrainHeight[x])];
    if (zone !== ZONE.highland && zone !== ZONE.midland) continue;
    if (tank.terrainHeight[x] <= tank.waterlineY) continue;
    let flat = true;
    for (let d = -2; d <= 2; d++) {
      const h =
        tank.terrainHeight[Math.min(tank.width - 1, Math.max(0, x + d))];
      if (Math.abs(h - tank.terrainHeight[x]) > 1) {
        flat = false;
        break;
      }
    }
    if (flat) candidates.push(x);
  }
  if (candidates.length === 0) return [];
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked = [candidates[0]];
  if (tank.landPercent >= 55) {
    for (const c of candidates.slice(1)) {
      if (Math.abs(c - picked[0]) > tank.width * 0.22 && rng() < 0.5) {
        picked.push(c);
        break;
      }
    }
  }
  return picked.map((x) => ({
    x,
    y: tank.terrainHeight[x],
    variant: Math.floor(rng() * 1000),
  }));
}

function drawTrees(
  g: Graphics,
  layout: TankLayout,
  anchors: readonly TreeAnchor[],
  plants: number,
  phase: number,
): void {
  g.clear();
  const growth = clamp01((plants - TREE_START) / (1 - TREE_START));
  if (growth <= 0) return;
  for (const anchor of anchors) {
    drawTree(g, layout, anchor, growth, plants, phase);
  }
}

/** S-curve trunk + branches + cloud-pad canopy - the Ghibli centerpiece. */
function drawTree(
  g: Graphics,
  layout: TankLayout,
  anchor: TreeAnchor,
  growth: number,
  plants: number,
  phase: number,
): void {
  const baseX = screenX(layout, anchor.x + 0.5);
  const baseY = screenY(layout, anchor.y);
  const v = anchor.variant;
  const leanSign = v % 2 === 0 ? 1 : -1;
  const s = layout.scale;
  // A BONSAI is SHORT and STOUT: a fat, gnarled, fast-tapering trunk with a
  // wide root flare (nebari) and foliage pruned into stacked horizontal
  // clouds. Height:girth ≈ 3-4:1, never the tall thin sapling we had.
  const trunkPx = s * (7 + growth * 9); // 7..16 cells — short
  const baseWidth = s * (2.2 + growth * 3.2); // 2.2..5.4 cells — THICK
  const sway = Math.sin(phase * 0.5 + v) * 0.05 * growth;

  // gnarled trunk: a couple of bends (movement) up a short spine
  const bend = (0.7 + (v % 4) * 0.25) * leanSign;
  const spine = (t: number): [number, number] => {
    const x =
      baseX +
      Math.sin(t * Math.PI * 1.3) * bend * s * 1.4 +
      sway * t * trunkPx;
    const y = baseY - t * trunkPx;
    return [x, y];
  };

  // trunk body — tapered polygon, fat base to a narrow apex
  const widthAt = (t: number): number =>
    (baseWidth * (1 - t) ** 1.4 + s * 0.5) * 0.5;
  const left: number[] = [];
  const right: number[] = [];
  const SEGS = 10;
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const [sx, sy] = spine(t);
    const w = widthAt(t);
    left.push(sx - w, sy);
    right.unshift(sx + w, sy);
  }
  // nebari — root flare spreading wider than the trunk at the very base
  left.unshift(baseX - baseWidth * 0.85, baseY + s * 0.3);
  right.push(baseX + baseWidth * 0.85, baseY + s * 0.3);
  g.poly([...left, ...right]).fill(SCENE.woodDark);
  // surface roots humping out either side of the base
  for (const side of [-1, 1]) {
    g.ellipse(baseX + side * baseWidth * 0.6, baseY, baseWidth * 0.4, s * 0.5).fill(
      SCENE.woodDark,
    );
  }
  // lit left face + a few dark bark furrows for gnarl
  const litL: number[] = [];
  const litR: number[] = [];
  for (let i = 0; i <= SEGS; i++) {
    const t = i / SEGS;
    const [sx, sy] = spine(t);
    const w = widthAt(t);
    litL.push(sx - w * 0.8, sy);
    litR.unshift(sx - w * 0.1, sy);
  }
  g.poly([...litL, ...litR]).fill({ color: SCENE.wood, alpha: 0.85 });
  for (let f = 0; f < 2; f++) {
    const [ax, ay] = spine(0.15 + f * 0.3);
    const [bx, by] = spine(0.5 + f * 0.28);
    g.moveTo(ax, ay)
      .quadraticCurveTo((ax + bx) / 2 + s * 0.3, (ay + by) / 2, bx, by)
      .stroke({ color: SCENE.woodDark, width: Math.max(1, s * 0.18), alpha: 0.5 });
  }

  // foliage as STACKED HORIZONTAL CLOUD PADS (cloud-pruned tiers) — the
  // defining bonsai canopy. Lower tiers wider, apex rounded.
  const tierCount = 2 + Math.floor(growth * 2); // 2..4 tiers
  const padScale = s * (1.5 + growth * 1.8);
  interface Pad {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  }
  const pads: Pad[] = [];
  for (let tier = 0; tier < tierCount; tier++) {
    const ft = tier / Math.max(1, tierCount - 1); // 0 bottom .. 1 apex
    const [tx, ty] = spine(0.5 + ft * 0.5);
    // bottom tiers are broad shelves, the apex is a compact dome
    const tierWidth = padScale * (1.9 - ft * 1.0);
    const side = tier % 2 === 0 ? leanSign : -leanSign;
    const cx = tx + side * tierWidth * 0.25;
    const cy = ty - padScale * 0.2;
    const blobs = 3 + (tier % 2);
    for (let b = 0; b < blobs; b++) {
      const bt = (b / (blobs - 1) - 0.5) * 2;
      pads.push({
        cx: cx + bt * tierWidth * 0.5 + sway * padScale * 0.4,
        cy: cy - Math.cos(bt * 1.2) * padScale * 0.18,
        rx: tierWidth * (0.42 - Math.abs(bt) * 0.08),
        ry: tierWidth * 0.3,
      });
    }
  }
  for (const p of pads) {
    g.ellipse(p.cx + p.rx * 0.1, p.cy + p.ry * 0.35, p.rx * 0.95, p.ry * 0.9).fill({
      color: SCENE.algaeDeep,
      alpha: 0.85,
    });
  }
  for (const p of pads) {
    g.ellipse(p.cx, p.cy, p.rx, p.ry).fill({ color: SCENE.leaf, alpha: 0.97 });
  }
  for (const p of pads) {
    g.ellipse(p.cx - p.rx * 0.18, p.cy - p.ry * 0.3, p.rx * 0.6, p.ry * 0.5).fill({
      color: SCENE.leafLight,
      alpha: 0.9,
    });
  }

  // blossoms only at full maturity, only on some trees
  if (plants >= 0.85 && v % 3 === 0) {
    const blossoms = 3 + Math.floor(((plants - 0.85) / 0.15) * 6);
    for (let k = 0; k < blossoms; k++) {
      const p = pads[k % pads.length];
      g.circle(
        p.cx + Math.sin(v * 7.7 + k * 3.3) * p.rx,
        p.cy + Math.cos(v * 3.3 + k * 2.1) * p.ry,
        Math.max(0.8, s * 0.26),
      ).fill({ color: 0xe89bb0, alpha: 0.95 });
    }
  }
}

// ------------------------------------------------------------------ lily

interface LilyAnchor {
  readonly x: number;
  readonly threshold: number;
  readonly variant: number;
}

/** floating pads live over DEEP water only - never near the bank */
function pickLilyAnchors(tank: TankState, seed: number): LilyAnchor[] {
  if (tank.waterlineY <= 3) return [];
  const rng = mulberry32(seed);
  const candidates: number[] = [];
  for (let x = 3; x < tank.width - 3; x++) {
    if (tank.terrainHeight[x] >= tank.waterlineY - 3) continue;
    candidates.push(x);
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, MAX_LILIES).map((x, i) => ({
    x: x + rng() * 0.6,
    threshold: 0.5 + (i / MAX_LILIES) * 0.3,
    variant: Math.floor(rng() * 1000),
  }));
}

/** "bèo" - pads riding the live water surface, drifting and bobbing */
function drawLilies(
  g: Graphics,
  tank: TankState,
  layout: TankLayout,
  anchors: readonly LilyAnchor[],
  algae: number,
  phase: number,
): void {
  g.clear();
  if (algae < 0.5 || tank.waterlineY <= 3) return;
  for (const anchor of anchors) {
    const growth = clamp01(
      ((algae - anchor.threshold) / (1 - anchor.threshold)) * 1.4,
    );
    if (growth <= 0) continue;
    // hard guard: never render over land, whatever the terrain does
    const column = Math.min(
      tank.width - 1,
      Math.max(0, Math.round(anchor.x)),
    );
    if (tank.terrainHeight[column] >= tank.waterlineY - 1) continue;

    const drift = Math.sin(phase * 0.35 + anchor.variant) * 0.5;
    const bob = Math.sin(phase * 0.7 + anchor.variant * 1.7) * 0.12;
    const cx = screenX(layout, anchor.x + 0.5 + drift);
    const cy = screenY(layout, tank.waterlineY + bob);
    const r =
      layout.scale * (1 + growth * 1.6) * (0.8 + (anchor.variant % 4) * 0.1);
    const ry = r * 0.42;
    // soft shadow on the water under the pad
    g.ellipse(cx + r * 0.08, cy + ry * 0.5, r * 0.95, ry * 0.7).fill({
      color: SCENE.waterDeep,
      alpha: 0.18,
    });
    // pad with a seeded V-notch
    const notch = anchor.variant % 2 === 0 ? 0.18 : -0.18;
    g.ellipse(cx, cy, r, ry).fill({ color: SCENE.algae, alpha: 0.95 });
    g.poly([
      cx + notch * r, cy - ry,
      cx + notch * r * 1.6, cy,
      cx + notch * r, cy + ry,
    ]).fill({ color: SCENE.waterSurface, alpha: 0.9 });
    g.circle(cx, cy, Math.max(0.6, r * 0.1)).fill({
      color: SCENE.algaeDeep,
      alpha: 0.7,
    });
    g.ellipse(cx - r * 0.1, cy - ry * 0.25, r * 0.7, ry * 0.5).fill({
      color: SCENE.leafLight,
      alpha: 0.35,
    });
  }
}
