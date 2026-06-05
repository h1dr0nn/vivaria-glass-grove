import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import { environmentAt } from "../../sim/ecology";
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

  // how lush the planting looks this season — fuller in summer, sparser in
  // winter, so the underwater garden visibly waxes and wanes over the years
  const lushOf = (sim: SimState): number => {
    const env = environmentAt(sim.seed, sim.simTimeMs);
    const warmth = 0.5 + 0.5 * Math.sin(env.seasonPhase * Math.PI * 2);
    return 0.6 + 0.4 * warmth;
  };

  const render = (sim: SimState): void => {
    const lush = lushOf(sim);
    const season = environmentAt(sim.seed, sim.simTimeMs).seasonName;
    drawMicrobes(microbeGfx, tank, layout, speckSeeds, wetness, sim, swayPhase);
    drawAlgae(algaeGfx, tank, layout, algaeAnchors, sim.scalars.algae, lush, swayPhase);
    drawTrees(treeGfx, layout, treeAnchors, tank.terrainHeight, sim.scalars.plants, sim.treeAgeMs ?? 0, season, swayPhase);
    drawPlants(plantGfx, layout, plantAnchors, sim.scalars.plants, lush, swayPhase);
    drawLilies(lilyGfx, tank, layout, lilyAnchors, sim.scalars.algae, swayPhase);
  };

  const update = (sim: SimState): void => {
    lastSim = sim;
    render(sim);
  };

  const tick = (timeMs: number): void => {
    swayPhase = timeMs / 1000;
    if (lastSim) render(lastSim);
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
  lush: number,
  phase: number,
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

  // tufts wake up one by one as the bloom spreads — they wave underwater and
  // fill out in summer / thin in winter (lush)
  for (const anchor of anchors) {
    const growth = staggeredGrowth(algae, anchor.threshold) * lush;
    if (growth <= 0.02) continue;
    const cx = screenX(layout, anchor.x + 0.5);
    const cy = screenY(layout, anchor.y + 0.2);
    const size = layout.scale * (1 + growth * 3.6) * (0.75 + (anchor.variant % 4) * 0.12);
    const wave = Math.sin(phase * 1.1 + anchor.variant) * 0.35;
    const blades = 3 + (anchor.variant % 4);
    for (let b = 0; b < blades; b++) {
      const lean = (b / (blades - 1) - 0.5) * 1.7 + wave;
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
  lush: number,
  phase: number,
): void {
  g.clear();
  if (plants <= 0.005) return;

  for (const anchor of anchors) {
    const growth = staggeredGrowth(plants, anchor.threshold) * lush;
    if (growth <= 0.02) continue;
    // a clearly visible underwater/breeze sway
    const sway = Math.sin(phase * 0.9 + anchor.variant) * 0.22 * growth;
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

/** the trunk keeps thickening for ~40 in-game days, long after it's full height */
const TREE_GIRTH_TAU_MS = 40 * 24 * 3_600_000;

/** leaf palette + fullness per season — the canopy changes its coat */
interface Foliage {
  readonly base: number;
  readonly light: number;
  readonly shade: number;
  readonly fullness: number; // 0..1, winter is bare
}
function foliageFor(season: string): Foliage {
  switch (season) {
    case "autumn":
      return { base: 0xc8893a, light: 0xe0b066, shade: 0x9a5f28, fullness: 0.85 };
    case "winter":
      return { base: 0x7d8a5e, light: 0x97a273, shade: 0x5d6845, fullness: 0.45 };
    case "spring":
      return { base: SCENE.leaf, light: SCENE.leafLight, shade: SCENE.algaeDeep, fullness: 0.95 };
    default: // summer
      return { base: SCENE.leaf, light: SCENE.leafLight, shade: SCENE.algaeDeep, fullness: 1 };
  }
}

function drawTrees(
  g: Graphics,
  layout: TankLayout,
  anchors: readonly TreeAnchor[],
  terrain: readonly number[],
  plants: number,
  treeAgeMs: number,
  season: string,
  phase: number,
): void {
  g.clear();
  const growth = clamp01((plants - TREE_START) / (1 - TREE_START));
  if (growth <= 0) return;
  // girth is driven by AGE, not the plant scalar — the trunk slowly fattens
  // over many days while height settles early (how a bonsai actually ages)
  const girth = 1 - Math.exp(-treeAgeMs / TREE_GIRTH_TAU_MS);
  const foliage = foliageFor(season);
  for (const anchor of anchors) {
    drawTree(g, layout, anchor, terrain, growth, girth, plants, foliage, phase);
  }
}

/** S-curve trunk + branches + cloud-pad canopy - the Ghibli centerpiece. */
function drawTree(
  g: Graphics,
  layout: TankLayout,
  anchor: TreeAnchor,
  terrain: readonly number[],
  growth: number,
  girth: number,
  plants: number,
  foliage: Foliage,
  phase: number,
): void {
  const baseX = screenX(layout, anchor.x + 0.5);
  const baseY = screenY(layout, anchor.y);
  const v = anchor.variant;
  const leanSign = v % 2 === 0 ? 1 : -1;
  const s = layout.scale;
  // seeded 0..1 helper so every tree gets its own proportions & bends
  const rv = (k: number): number => {
    const x = Math.sin(v * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  // The tree GROWS over the years: it keeps gaining height and new canopy
  // tiers with age (girth), and each tree's bends/tiers are seeded so no two
  // tanks look alike. Height climbs to ~30 cells — about double the old cap.
  const trunkPx = s * (12 + growth * 8 + girth * 14); // up to ~34 cells
  // a substantial trunk — fattens with age and stays thick well up its height
  const baseWidth = s * (2.6 + girth * 5.4);

  // gnarled trunk: two seeded bends up a tall spine (movement)
  const bend1 = (0.6 + rv(1) * 0.9) * leanSign;
  const bend2 = (0.5 + rv(2) * 0.8) * -leanSign;
  const spine = (t: number): [number, number] => {
    const x =
      baseX +
      Math.sin(t * Math.PI * 1.1) * bend1 * s * 1.6 +
      Math.sin(t * Math.PI * 2.1) * bend2 * s * 0.7 +
      Math.sin(phase * 0.6 + v) * t * t * s * 0.5; // top sways most
    const y = baseY - t * trunkPx;
    return [x, y];
  };

  // trunk body — tapered polygon, fat base staying thick well up the height
  const widthAt = (t: number): number =>
    (baseWidth * (1 - t * 0.82) ** 0.95 + s * 0.6) * 0.5;
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
  // SLOPE-AWARE base: the nebari flare and roots follow the local ground so
  // the tree sits ON the bank (flare slants with the soil; downhill roots
  // reach farther and plunge deeper to grip the falling ground).
  const cxCell = anchor.x;
  const xL = Math.max(0, cxCell - 1);
  const xR = Math.min(terrain.length - 1, cxCell + 1);
  const slopeCells = (terrain[xR] - terrain[xL]) / Math.max(1, xR - xL); // +→rises right
  const SPREAD = (baseWidth / s) * 0.85; // flare half-span in cells
  const groundPx = (dCells: number): [number, number] => [
    screenX(layout, anchor.x + 0.5 + dCells),
    screenY(layout, anchor.y + slopeCells * dCells),
  ];
  const gL = groundPx(-SPREAD);
  const gR = groundPx(SPREAD);
  // flare sitting on the diagonal ground, rising into the trunk
  g.poly([
    gL[0], gL[1],
    baseX - baseWidth * 0.32, baseY - s * 0.5,
    baseX + baseWidth * 0.32, baseY - s * 0.5,
    gR[0], gR[1],
  ]).fill(SCENE.woodDark);
  // roots plunging into the soil on each side
  for (const side of [-1, 1] as const) {
    const collar = groundPx(side * SPREAD * 0.7);
    const isDownhill = slopeCells !== 0 && side !== Math.sign(slopeCells);
    const rootN = 2 + (isDownhill ? 1 : 0);
    for (let r = 0; r < rootN; r++) {
      const reach = baseWidth * (0.4 + r * 0.35) * (isDownhill ? 1.5 : 1);
      const depth = s * (1.1 + r * 0.6) * (isDownhill ? 1.6 : 1);
      g.moveTo(collar[0], collar[1] - s * 0.2)
        .quadraticCurveTo(
          collar[0] + side * reach * 0.6,
          collar[1] + depth * 0.4,
          collar[0] + side * reach,
          collar[1] + depth,
        )
        .stroke({
          color: SCENE.woodDark,
          width: Math.max(1, baseWidth * 0.18 * (1 - r * 0.2)),
          alpha: 0.9,
          cap: "round",
        });
    }
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

  // ---- ORGANIC CANOPY: a recursive jittered armature of MEANDERING limbs,
  // biased to one heavy side with gaps & varied forks → an irregular cloud-
  // pruned silhouette, never a symmetric triangle (research-designed). ----
  const padScale = s * (1.6 + growth * 1.4 + girth * 1.0);
  const heavySide = leanSign;
  const maxDepth = 1 + Math.round(girth * 2); // 1..3 levels with age
  const primaryCount = 2 + Math.round(girth * 3); // 2..5 primaries
  const ATTACH = [0.34, 0.5, 0.62, 0.78, 0.9];

  interface Limb {
    x: number;
    y: number;
    ang: number; // 0 = straight up; + leans toward heavySide
    len: number;
    w: number;
    depth: number;
    key: number;
  }

  // one curved, tapered limb segment → returns its (curved) tip + heading
  const drawLimb = (c: Limb): { x: number; y: number; ang: number } => {
    const bend = (rv(c.key + 2) - 0.5) * 0.9; // meander
    const angEnd = c.ang + bend;
    const droop = 0.02 * (c.len / s) * (0.4 + 0.6 * rv(c.key + 5)); // gravity sag
    const angTip = angEnd + droop;
    const sway = Math.sin(phase * 0.6 + v + c.depth) * s * 0.12;
    const px = Math.cos(c.ang);
    const py = Math.sin(c.ang);
    const k1 = (rv(c.key + 3) - 0.3) * c.len * 0.45;
    const k2 = (rv(c.key + 4) - 0.7) * c.len * 0.45;
    const c1x = c.x + Math.sin(c.ang) * c.len * 0.33 + px * k1;
    const c1y = c.y - Math.cos(c.ang) * c.len * 0.33 + py * k1;
    const c2x = c.x + Math.sin(angEnd) * c.len * 0.66 + px * k2 + sway * 0.5;
    const c2y = c.y - Math.cos(angEnd) * c.len * 0.66 + py * k2;
    const tipX = c.x + Math.sin(angTip) * c.len + sway;
    const tipY = c.y - Math.cos(angTip) * c.len;
    const bez = (t: number): [number, number] => {
      const u = 1 - t;
      return [
        u * u * u * c.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tipX,
        u * u * u * c.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * tipY,
      ];
    };
    const top: number[] = [];
    const bot: number[] = [];
    const BSEG = 6;
    let prev = bez(0);
    for (let i = 0; i <= BSEG; i++) {
      const t = i / BSEG;
      const b = bez(t);
      let nx = b[1] - prev[1];
      let ny = -(b[0] - prev[0]);
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const wi = c.w * (1 - t) ** 1.3 + 0.4;
      top.push(b[0] + nx * wi, b[1] + ny * wi);
      bot.unshift(b[0] - nx * wi, b[1] - ny * wi);
      prev = b;
    }
    g.poly([...top, ...bot]).fill({ color: SCENE.woodDark, alpha: 0.95 });
    return { x: tipX, y: tipY, ang: angTip };
  };

  const dotColor = foliage.base === 0xc8893a ? 0xd86a3a : 0xe89bb0;
  const grow = (c: Limb): void => {
    const tip = drawLimb(c);
    const puff = c.depth >= maxDepth || rv(c.key + 7) < 0.3;
    if (puff) {
      const cw =
        padScale * (1.15 - c.depth * 0.22) * (0.8 + rv(c.key + 8) * 0.5) *
        (0.55 + foliage.fullness * 0.55);
      const r = c.w * 1.5;
      const ccx = tip.x + Math.sin(tip.ang) * r;
      const ccy = tip.y - Math.cos(tip.ang) * r - cw * 0.3;
      drawCloud(g, ccx, ccy, cw, foliage, c.key, phase);
      if (plants >= 0.85 && v % 3 === 0) {
        for (let k = 0; k < 3; k++) {
          g.circle(
            ccx + Math.sin(v * 7.7 + c.key + k * 3.3) * cw * 0.4,
            ccy + Math.cos(v * 3.3 + k * 2.1) * cw * 0.22,
            Math.max(0.8, s * 0.24),
          ).fill({ color: dotColor, alpha: 0.95 });
        }
      }
    }
    if (c.depth >= maxDepth) return;
    const n = 1 + Math.floor(rv(c.key + 13) * 2.5); // 1..3 children
    for (let i = 0; i < n; i++) {
      const spreadSign = i % 2 === 0 ? 1 : -1;
      const bias = spreadSign === heavySide ? 1.25 : 0.7;
      grow({
        x: tip.x,
        y: tip.y,
        ang: tip.ang + spreadSign * (0.5 + rv(c.key + i * 9 + 1) * 0.6),
        len: c.len * (0.62 + rv(c.key + i * 9 + 3) * 0.22) * bias,
        w: c.w * 0.62,
        depth: c.depth + 1,
        key: c.key * 4 + i + 31,
      });
    }
  };

  for (let p = 0; p < primaryCount; p++) {
    const sideP = p % 2 === 0 ? heavySide : -heavySide;
    if (sideP !== heavySide && rv(p * 17 + 3) < 0.35) continue; // light-side gaps
    const t = clamp01((ATTACH[p] ?? 0.85) + (rv(p * 17 + 1) - 0.5) * 0.1);
    const [ax, ay] = spine(t);
    const heavy = sideP === heavySide;
    grow({
      x: ax,
      y: ay,
      ang: sideP * (0.55 + rv(p * 17 + 2) * 0.45) + (t > 0.8 ? heavySide * 0.25 : 0),
      len: padScale * (heavy ? 1.25 : 0.7) * (0.9 + rv(p * 17 + 4) * 0.5),
      w: baseWidth * 0.3 * (1 - t * 0.4),
      depth: 0,
      key: v + p * 97 + 50,
    });
  }
}

/**
 * A cohesive cloud-pruned pad — the niwaki look. Built as a UNION of heavily
 * overlapping circles painted in exactly THREE passes (one fill per tone):
 *   1) shade: all lobe circles, enlarged + nudged down → one dark under-rim
 *   2) body:  all lobe circles → overlap auto-merges into ONE bumpy blob
 *   3) light: a SINGLE big highlight, top-left
 * The bottoms of the lobes are aligned so the pad has a flat base and sits on
 * its branch. NEVER shade/highlight per lobe — that is the popcorn bug.
 */
function drawCloud(
  g: Graphics,
  cx: number,
  cy: number,
  width: number,
  foliage: Foliage,
  seed: number,
  phase: number,
): void {
  const w = width * 0.5; // half width
  const h = width * 0.34; // half height — wider than tall (a pad, not a ball)
  const N = 5;
  const lobes: { lx: number; ly: number; r: number }[] = [];
  for (let i = 0; i < N; i++) {
    const ux = (i / (N - 1) - 0.5) * 2; // -1..1
    const j = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    const jitter = j - Math.floor(j) - 0.5; // -0.5..0.5
    const r = h * (0.98 - 0.16 * ux * ux) * (1 + 0.16 * jitter);
    const breeze = Math.sin(phase * 1.4 + seed + i) * w * 0.03;
    const lx = cx + ux * (w - r * 0.7) + breeze;
    const ly = cy + (h - r); // align bottoms → flat base, bumpy top
    lobes.push({ lx, ly, r });
  }
  // 1) shade rim
  for (const l of lobes) g.circle(l.lx, l.ly + h * 0.16, l.r * 1.05);
  g.fill({ color: foliage.shade, alpha: 0.95 });
  // 2) body — single fill over all overlapping circles = one cohesive blob
  for (const l of lobes) g.circle(l.lx, l.ly, l.r);
  g.fill({ color: foliage.base, alpha: 0.98 });
  // 3) one big highlight on the top-left
  g.ellipse(cx - w * 0.22, cy - h * 0.4, w * 0.5, h * 0.5).fill({
    color: foliage.light,
    alpha: 0.85,
  });
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
