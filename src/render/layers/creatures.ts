import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import type { PopulationEntry, SpeciesDef } from "../../sim/species";
import type { TankState } from "../../sim/tankgen";
import { screenX, screenY, type TankLayout } from "../layout";

/**
 * Creatures, drawn from the deterministic population.
 *
 * PERFORMANCE CONTRACT: each creature is built ONCE as a small Container of
 * sub-part Graphics; the per-frame path touches ONLY transforms (position /
 * rotation / scale flips and joint rotations) - zero re-tessellation - so a
 * 60fps creature loop costs a few hundred float writes. Counts come from the
 * sim; motion is cosmetic, seeded, and bounded. The layer never mutates sim.
 */

const SPAWN_STREAM_BASE = 40;
/** smoothing rate for the render-position lerp (higher = snappier) */
const SMOOTH_RATE = 12;

interface ColumnRange {
  readonly start: number;
  readonly end: number;
}

interface CreatureParts {
  readonly tail?: Graphics;
  readonly wingLeft?: Graphics;
  readonly wingRight?: Graphics;
  readonly claw?: Graphics;
  readonly head?: Graphics;
  readonly legs?: readonly Graphics[];
  /** worm-style parts that must redraw each frame (kept tiny) */
  readonly redraw?: Graphics;
}

interface Creature {
  readonly def: SpeciesDef;
  readonly container: Container;
  readonly parts: CreatureParts;
  x: number;
  y: number;
  renderX: number;
  renderY: number;
  dir: number;
  phase: number;
  speed: number;
  action: number;
  /** generic per-species extra state (turtle mode, shrimp flick) */
  extra: number;
}

export interface CreatureLayer {
  readonly container: Container;
  update(population: readonly PopulationEntry[]): void;
  /** transform-only animation frame - called from the creature rAF loop */
  tick(timeMs: number): void;
}

export function buildCreatures(
  tank: TankState,
  layout: TankLayout,
): CreatureLayer {
  const root = new Container();
  const ranges = computeRanges(tank);
  const flocks = new Map<string, Creature[]>();
  let lastTimeMs = 0;

  const update = (population: readonly PopulationEntry[]): void => {
    const seen = new Set<string>();
    for (const entry of population) {
      seen.add(entry.def.id);
      const flock = flocks.get(entry.def.id) ?? [];
      while (flock.length < entry.count) {
        const creature = spawn(tank, layout, ranges, entry.def, flock.length);
        if (!creature) break;
        root.addChild(creature.container);
        flock.push(creature);
      }
      while (flock.length > entry.count) {
        const removed = flock.pop();
        removed?.container.destroy({ children: true });
      }
      flocks.set(entry.def.id, flock);
    }
    for (const [id, flock] of flocks) {
      if (seen.has(id)) continue;
      for (const creature of flock) {
        creature.container.destroy({ children: true });
      }
      flocks.delete(id);
    }
  };

  const tick = (timeMs: number): void => {
    const dt =
      lastTimeMs === 0
        ? 0.016
        : Math.min(0.05, Math.max(0, (timeMs - lastTimeMs) / 1000));
    lastTimeMs = timeMs;
    const time = timeMs / 1000;
    for (const flock of flocks.values()) {
      for (const creature of flock) {
        move(creature, tank, ranges, dt, time);
        animate(creature, layout, dt, time);
      }
    }
  };

  return { container: root, update, tick };
}

// ------------------------------------------------------------- habitats

function longestRun(columns: readonly boolean[]): ColumnRange | null {
  let best: ColumnRange | null = null;
  let start = -1;
  for (let x = 0; x <= columns.length; x++) {
    const on = x < columns.length && columns[x];
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (!best || x - start > best.end - best.start) {
        best = { start, end: x };
      }
      start = -1;
    }
  }
  return best;
}

interface Ranges {
  readonly water: ColumnRange | null;
  readonly land: ColumnRange | null;
  readonly shore: ColumnRange | null;
  readonly air: ColumnRange | null;
}

function computeRanges(tank: TankState): Ranges {
  const water = longestRun(
    tank.terrainHeight.map((h) => h < tank.waterlineY - 1),
  );
  const land = longestRun(tank.terrainHeight.map((h) => h >= tank.waterlineY));
  // air = the whole open span above the substrate (over water AND land), so
  // flyers cross the water surface, not just hover over the dirt
  const air: ColumnRange = { start: 2, end: tank.width - 2 };
  // amphibians roam BEYOND the strict tideline - a narrow shore run made
  // frogs ping-pong in a tiny pen ("bị kẹt"); widen it well into both sides
  const strictShore = longestRun(
    tank.terrainHeight.map(
      (h) => tank.waterlineY > 0 && Math.abs(h - tank.waterlineY) <= 3,
    ),
  );
  const shore = strictShore
    ? {
        start: Math.max(2, strictShore.start - 10),
        end: Math.min(tank.width - 2, strictShore.end + 10),
      }
    : null;
  return { water, land, shore, air };
}

function rangeFor(def: SpeciesDef, ranges: Ranges): ColumnRange | null {
  switch (def.habitat) {
    case "water":
    case "floor":
      return ranges.water;
    case "shore":
      return ranges.shore ?? ranges.land;
    case "land":
      return ranges.land;
    case "air":
      return ranges.air;
    default:
      return null;
  }
}

function homeY(def: SpeciesDef, tank: TankState, x: number): number {
  const column = clampColumn(tank, x);
  const surface = tank.terrainHeight[column];
  switch (def.habitat) {
    case "water": {
      const span = Math.max(1, tank.waterlineY - 2 - surface);
      return surface + 1 + span * 0.55;
    }
    case "floor":
      return surface + 0.45;
    case "shore":
      return Math.max(surface, tank.waterlineY) + 0.45;
    case "land":
      return surface + 0.4;
    case "air":
      // hover above the SURFACE — water columns use the waterline, land
      // columns use the terrain — so flyers drift over the pond too
      return Math.max(surface, tank.waterlineY) + 4;
    default:
      return surface + 1;
  }
}

function clampColumn(tank: TankState, x: number): number {
  return Math.min(tank.width - 1, Math.max(0, Math.round(x)));
}

// --------------------------------------------------------------- spawn

function spawn(
  tank: TankState,
  layout: TankLayout,
  ranges: Ranges,
  def: SpeciesDef,
  index: number,
): Creature | null {
  const range = rangeFor(def, ranges);
  if (!range || range.end - range.start < 4) return null;
  const rng = mulberry32(
    splitSeed(tank.seed, SPAWN_STREAM_BASE + hashId(def.id)) + index,
  );
  const x = range.start + 2 + rng() * (range.end - range.start - 4);
  const y = homeY(def, tank, x);
  const { container, parts } = buildBody(def, layout);
  return {
    def,
    container,
    parts,
    x,
    y,
    renderX: x,
    renderY: y,
    dir: rng() < 0.5 ? -1 : 1,
    phase: rng() * Math.PI * 2,
    speed: 0.6 + rng() * 0.8,
    action: rng(),
    extra: 0,
  };
}

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 1000;
}

// -------------------------------------------------------------- motion

function move(
  c: Creature,
  tank: TankState,
  ranges: Ranges,
  dt: number,
  time: number,
): void {
  const range = rangeFor(c.def, ranges);
  if (!range) return;
  const margin = 2;
  const clampX = (): void => {
    c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
  };

  switch (c.def.movement) {
    case "drift": {
      c.x += Math.sin(time * 0.4 + c.phase) * dt * 1.2;
      c.y += Math.cos(time * 0.3 + c.phase * 1.7) * dt * 0.9;
      confineWater(c, tank);
      break;
    }
    case "school": {
      // the school roams the INNER 70% of open water — never piles against
      // the bank ("hay bơi ra chỗ giao đất rồi đứng đấy")
      const inset = margin + (range.end - range.start) * 0.15;
      const span = Math.max(2, range.end - range.start - inset * 2);
      const center =
        range.start + inset + ((Math.sin(time * 0.07 + c.def.size) + 1) / 2) * span;
      const targetX = center + Math.sin(c.phase * 5) * Math.min(6, span * 0.2);
      const dx = targetX - c.x;
      if (Math.abs(dx) > 0.3) c.dir = Math.sign(dx);
      c.x += dx * dt * 0.7;
      c.y += Math.sin(time * 0.9 + c.phase * 3) * dt * 1.4;
      confineWater(c, tank);
      break;
    }
    case "swim": {
      // a solitary mid-water wanderer — long lazy cruises, turns before the
      // bank, never schools
      c.action -= dt;
      if (c.action <= 0) {
        c.action = 2.5 + ((c.phase * 521) % 3);
        c.dir = Math.sin(c.phase * 9.1 + time * 0.7) < 0 ? -1 : 1;
      }
      const inset = margin + (range.end - range.start) * 0.12;
      c.x += c.dir * c.speed * dt * 1.6;
      if (c.x < range.start + inset || c.x > range.end - inset) c.dir *= -1;
      c.x = Math.min(range.end - inset, Math.max(range.start + inset, c.x));
      c.y += Math.sin(time * 0.8 + c.phase * 2) * dt * 1.0;
      confineWater(c, tank);
      break;
    }
    case "crawl": {
      c.x += c.dir * c.speed * dt * 0.7;
      if (c.x < range.start + margin || c.x > range.end - margin) c.dir *= -1;
      clampX();
      c.y = homeY(c.def, tank, c.x);
      break;
    }
    case "scuttle": {
      moveScuttle(c, tank, range, margin, dt, time);
      break;
    }
    case "hop": {
      c.action -= dt;
      if (c.action <= -0.45) {
        c.action = 1.4 + ((c.phase * 997) % 1.7);
        c.dir = Math.sin(time + c.phase) < 0 ? -1 : 1;
      }
      const ground = homeY(c.def, tank, c.x);
      if (c.action <= 0) {
        const t = -c.action / 0.45;
        c.x += c.dir * c.speed * dt * 5;
        if (c.x < range.start + margin || c.x > range.end - margin) c.dir *= -1;
        clampX();
        c.y = ground + Math.sin(t * Math.PI) * 1.6;
      } else {
        c.y = ground;
      }
      break;
    }
    case "wiggle": {
      c.y = homeY(c.def, tank, c.x) + Math.sin(time * 2.2 + c.phase) * 0.15;
      break;
    }
    case "fly": {
      c.x += Math.sin(time * 0.5 + c.phase) * dt * 4;
      const ground = homeY(c.def, tank, c.x);
      c.y = ground + 2 + Math.sin(time * 0.8 + c.phase * 2) * 2;
      clampX();
      c.dir = Math.cos(time * 0.5 + c.phase) >= 0 ? 1 : -1;
      break;
    }
    case "amble": {
      moveAmble(c, tank, range, margin, dt, time);
      break;
    }
    default:
      break;
  }
}

/** forage bursts; cherry shrimp add the real backward tail-flick escape */
function moveScuttle(
  c: Creature,
  tank: TankState,
  range: ColumnRange,
  margin: number,
  dt: number,
  time: number,
): void {
  const isShrimp = c.def.id === "cherry-shrimp";

  // extra < 0 ⇒ mid-flick (extra counts up to 0); extra > 0 ⇒ time to next
  if (isShrimp) {
    if (c.extra <= 0 && c.extra > -1) {
      // schedule the first/next flick 6–14s out (seeded by phase)
      if (c.extra === 0) c.extra = 6 + ((c.phase * 977) % 8);
    }
    if (c.extra < 0) {
      // mid-flick: quick backward arc, ~0.3s
      const progress = 1 + c.extra / 0.3; // 0→1
      c.x -= c.dir * c.speed * dt * 14;
      if (c.x < range.start + margin || c.x > range.end - margin) {
        c.dir *= -1;
      }
      c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
      c.y = homeY(c.def, tank, c.x) + Math.sin(progress * Math.PI) * 0.8;
      c.extra += dt;
      if (c.extra >= 0) c.extra = 6 + ((c.phase * 977) % 8);
      return;
    }
    c.extra -= dt;
    if (c.extra <= 0) {
      c.extra = -0.3; // begin flick
      return;
    }
  }

  c.action -= dt;
  if (c.action <= 0) {
    c.action = 1.2 + Math.sin(c.phase + time) * 0.8 + 1;
    c.dir = Math.sin(c.phase * 13.7 + time * 3.1) < 0 ? -1 : 1;
  }
  if (c.action > 1) {
    c.x += c.dir * c.speed * dt * 3.2;
    if (c.x < range.start + margin || c.x > range.end - margin) c.dir *= -1;
    c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
  }
  c.y = homeY(c.def, tank, c.x);
}

/** turtle: long unhurried walks, longer pauses, occasional basking */
function moveAmble(
  c: Creature,
  tank: TankState,
  range: ColumnRange,
  margin: number,
  dt: number,
  time: number,
): void {
  c.action -= dt;
  if (c.action <= 0) {
    // cycle mode: 0 walk → 1 pause → (sometimes) 2 bask → walk…
    const mode = c.extra;
    if (mode === 0) {
      const basks = Math.sin(c.phase * 31 + time) > 0.3;
      c.extra = basks ? 2 : 1;
      c.action = basks ? 5 + ((c.phase * 613) % 4) : 2 + ((c.phase * 401) % 3);
    } else {
      c.extra = 0;
      c.action = 3 + ((c.phase * 769) % 4);
      c.dir = Math.sin(c.phase * 7.3 + time * 0.9) < 0 ? -1 : 1;
    }
  }
  if (c.extra === 0) {
    // the heron wades noticeably faster than a turtle ambles
    const pace = c.def.id === "heron" ? 0.9 : 0.35;
    c.x += c.dir * c.speed * dt * pace;
    if (c.x < range.start + margin || c.x > range.end - margin) c.dir *= -1;
    c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
  }
  c.y = homeY(c.def, tank, c.x);
}

function confineWater(c: Creature, tank: TankState): void {
  const column = clampColumn(tank, c.x);
  const floor = tank.terrainHeight[column] + 1;
  const ceiling = tank.waterlineY - 1;
  if (c.y < floor) c.y = floor;
  if (c.y > ceiling) c.y = ceiling;
}

// ----------------------------------------------------------- animation

/** transform-only per-frame pass - positions, flips, joint rotations */
function animate(
  c: Creature,
  layout: TankLayout,
  dt: number,
  time: number,
): void {
  const k = Math.min(1, dt * SMOOTH_RATE);
  c.renderX += (c.x - c.renderX) * k;
  c.renderY += (c.y - c.renderY) * k;
  c.container.position.set(
    screenX(layout, c.renderX),
    screenY(layout, c.renderY),
  );
  c.container.scale.x = c.dir;

  const { parts } = c;
  switch (c.def.id) {
    case "ember-tetra":
    case "dwarf-cory":
    case "pygmy-rasbora":
    case "cherry-barb": {
      if (parts.tail) {
        parts.tail.rotation = Math.sin(time * 8 + c.phase) * 0.35;
      }
      c.container.rotation = Math.sin(time * 1.2 + c.phase) * 0.05;
      break;
    }
    case "cherry-shrimp": {
      const flicking = c.extra < 0;
      if (parts.tail) {
        parts.tail.rotation = flicking
          ? -1.1 * Math.sin((1 + c.extra / 0.3) * Math.PI)
          : Math.sin(time * 6 + c.phase) * 0.15;
      }
      c.container.rotation = flicking ? -0.25 * c.dir : 0;
      break;
    }
    case "meadow-moth":
    case "mayfly":
    case "mason-bee":
    case "dragonfly": {
      const rate = c.def.id === "mason-bee" || c.def.id === "dragonfly" ? 22 : 11;
      const flap = 0.3 + Math.abs(Math.sin(time * rate + c.phase)) * 0.8;
      if (parts.wingLeft) parts.wingLeft.scale.y = flap;
      if (parts.wingRight) parts.wingRight.scale.y = flap;
      if (c.def.id === "dragonfly") {
        c.container.rotation = Math.sin(time * 2 + c.phase) * 0.12;
      }
      break;
    }
    case "fiddler-crab": {
      if (parts.claw) {
        parts.claw.rotation = -0.3 + Math.sin(time * 2.1 + c.phase) * 0.3;
      }
      break;
    }
    case "pond-turtle": {
      const walking = c.extra === 0;
      const basking = c.extra === 2;
      if (parts.legs) {
        for (const [i, leg] of parts.legs.entries()) {
          leg.rotation = walking
            ? Math.sin(time * 4 + c.phase + i * Math.PI) * 0.35
            : 0;
        }
      }
      if (parts.head) {
        parts.head.rotation = basking
          ? -0.35
          : Math.sin(time * 1.6 + c.phase) * 0.08;
        parts.head.position.x = basking
          ? parts.head.position.x
          : parts.head.position.x;
      }
      break;
    }
    case "froglet": {
      // a gentle throat bob while resting
      c.container.rotation =
        c.action > 0 ? Math.sin(time * 3 + c.phase) * 0.02 : -0.08 * c.dir;
      break;
    }
    case "detritus-worm":
    case "land-planarian": {
      if (parts.redraw) {
        const g = parts.redraw;
        const s = layout.scale * c.def.size;
        const thick = c.def.id === "land-planarian";
        g.clear();
        g.moveTo(-s * 0.5, 0);
        const segs = thick ? 6 : 4;
        for (let i = 1; i <= segs; i++) {
          g.lineTo(
            -s * 0.5 + (i / segs) * s,
            Math.sin(time * (thick ? 1.4 : 2) + c.phase + i * 0.8) * s * 0.16,
          );
        }
        g.stroke({
          color: c.def.color,
          width: Math.max(0.8, s * (thick ? 0.32 : 0.18)),
          alpha: 0.9,
          cap: "round",
        });
        if (thick) {
          // a faint hammerhead at the leading end
          g.circle(s * 0.5, 0, s * 0.22).fill({ color: c.def.accent, alpha: 0.85 });
        }
      }
      break;
    }
    case "heron": {
      // a patient hunter: slow neck sway, then an occasional sharp STRIKE —
      // the head/neck plunges toward the water and lifts back up
      if (parts.head) {
        const s = layout.scale * c.def.size;
        const cyclePos = (time * 0.18 + c.phase) % 1;
        const strike =
          cyclePos > 0.85 ? Math.sin(((cyclePos - 0.85) / 0.15) * Math.PI) : 0;
        parts.head.position.y = -s * 1.2 + strike * s * 1.1;
        parts.head.rotation =
          Math.sin(time * 0.5 + c.phase) * 0.12 + strike * 0.5 * c.dir;
      }
      break;
    }
    default:
      break;
  }
}

// ----------------------------------------------------- one-time builders

function buildBody(
  def: SpeciesDef,
  layout: TankLayout,
): { container: Container; parts: CreatureParts } {
  const container = new Container();
  const s = layout.scale * def.size;
  let parts: CreatureParts = {};

  switch (def.id) {
    case "ember-tetra":
    case "dwarf-cory":
    case "pygmy-rasbora":
    case "cherry-barb":
      parts = buildFish(container, s, def.color, def.accent);
      break;
    case "cherry-shrimp":
      parts = buildShrimp(container, s, def.color, def.accent);
      break;
    case "ramshorn-snail":
    case "moss-snail":
      parts = buildSnail(container, s, def.color, def.accent);
      break;
    case "fiddler-crab":
      parts = buildCrab(container, s, def.color, def.accent);
      break;
    case "froglet":
      parts = buildFrog(container, s, def.color, def.accent);
      break;
    case "dwarf-isopod":
    case "leaf-beetle":
    case "velvet-mite":
    case "whirligig":
      parts = buildBug(container, s, def.color, def.accent);
      break;
    case "meadow-moth":
    case "mayfly":
      parts = buildMoth(container, s, def.color, def.accent);
      break;
    case "mason-bee":
      parts = buildBee(container, s, def.color, def.accent);
      break;
    case "dragonfly":
      parts = buildDragonfly(container, s, def.color, def.accent);
      break;
    case "land-planarian": {
      const redraw = new Graphics();
      container.addChild(redraw);
      parts = { redraw };
      break;
    }
    case "heron":
      parts = buildHeron(container, s, def.color, def.accent);
      break;
    case "detritus-worm": {
      const redraw = new Graphics();
      container.addChild(redraw);
      parts = { redraw };
      break;
    }
    case "pond-turtle":
      parts = buildTurtle(container, s, def.color, def.accent);
      break;
    default: {
      const dot = new Graphics();
      dot.circle(0, 0, Math.max(1, s * 0.5)).fill({
        color: def.color,
        alpha: 0.9,
      });
      container.addChild(dot);
      break;
    }
  }
  return { container, parts };
}

function buildFish(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const tail = new Graphics();
  tail
    .poly([0, 0, -s * 0.55, -s * 0.4, -s * 0.55, s * 0.4])
    .fill({ color: accent, alpha: 0.9 });
  tail.position.set(-s * 0.8, 0); // pivot at the body-tail joint
  const body = new Graphics();
  body.ellipse(0, 0, s * 0.9, s * 0.45).fill({ color, alpha: 0.95 });
  body.circle(s * 0.45, -s * 0.08, Math.max(0.7, s * 0.1)).fill({
    color: 0x2b2823,
    alpha: 0.9,
  });
  container.addChild(tail, body);
  return { tail };
}

function buildShrimp(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const body = new Graphics();
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    body
      .circle(-(t - 0.4) * s * 1.2, -Math.sin(t * Math.PI) * s * 0.35, s * (0.32 - t * 0.06))
      .fill({ color: i % 2 === 0 ? color : accent, alpha: 0.95 });
  }
  const tail = new Graphics();
  tail.circle(0, 0, s * 0.18).fill({ color: accent, alpha: 0.9 });
  tail.position.set(-s * 0.85, s * 0.05);
  container.addChild(body, tail);
  return { tail };
}

function buildSnail(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const body = new Graphics();
  body.ellipse(0, -s * 0.12, s * 0.75, s * 0.22).fill({
    color: accent,
    alpha: 0.9,
  });
  body.circle(-s * 0.15, -s * 0.55, s * 0.45).fill({ color, alpha: 0.95 });
  body.circle(-s * 0.15, -s * 0.55, s * 0.22).stroke({
    color: accent,
    width: Math.max(0.8, s * 0.1),
    alpha: 0.7,
  });
  container.addChild(body);
  return {};
}

function buildCrab(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const body = new Graphics();
  body.ellipse(0, -s * 0.3, s * 0.6, s * 0.4).fill({ color, alpha: 0.95 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      body
        .moveTo(side * s * 0.4, -s * 0.25)
        .lineTo(side * s * (0.5 + i * 0.16), s * 0.05)
        .stroke({
          color: accent,
          width: Math.max(0.8, s * 0.08),
          alpha: 0.85,
        });
    }
  }
  body.circle(-s * 0.15, -s * 0.72, s * 0.08).fill({ color: 0x2b2823 });
  body.circle(s * 0.15, -s * 0.72, s * 0.08).fill({ color: 0x2b2823 });
  const claw = new Graphics();
  claw.circle(s * 0.25, 0, s * 0.3).fill({ color: accent, alpha: 0.95 });
  claw.position.set(s * 0.5, -s * 0.5); // pivot at the shoulder
  container.addChild(body, claw);
  return { claw };
}

function buildFrog(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const body = new Graphics();
  body.ellipse(-s * 0.2, -s * 0.25, s * 0.42, s * 0.35).fill({
    color: accent,
    alpha: 0.95,
  });
  body.ellipse(s * 0.15, -s * 0.4, s * 0.45, s * 0.3).fill({
    color,
    alpha: 0.95,
  });
  body.circle(s * 0.45, -s * 0.62, s * 0.12).fill({ color });
  body.circle(s * 0.48, -s * 0.64, s * 0.05).fill({ color: 0x2b2823 });
  body
    .moveTo(s * 0.35, -s * 0.15)
    .lineTo(s * 0.45, 0)
    .stroke({ color: accent, width: Math.max(0.8, s * 0.1), alpha: 0.9 });
  container.addChild(body);
  return {};
}

function buildBug(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const body = new Graphics();
  body.ellipse(0, -s * 0.2, s * 0.5, s * 0.3).fill({ color, alpha: 0.95 });
  body
    .moveTo(-s * 0.45, -s * 0.2)
    .lineTo(s * 0.45, -s * 0.2)
    .stroke({ color: accent, width: Math.max(0.6, s * 0.06), alpha: 0.6 });
  container.addChild(body);
  return {};
}

function buildMoth(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const wingLeft = new Graphics();
  wingLeft.ellipse(-s * 0.35, 0, s * 0.4, s * 0.45).fill({
    color,
    alpha: 0.95,
  });
  const wingRight = new Graphics();
  wingRight.ellipse(s * 0.35, 0, s * 0.4, s * 0.45).fill({
    color,
    alpha: 0.95,
  });
  const body = new Graphics();
  body.ellipse(0, 0, s * 0.12, s * 0.3).fill({ color: accent, alpha: 0.95 });
  container.addChild(wingLeft, wingRight, body);
  return { wingLeft, wingRight };
}

function buildTurtle(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  // legs first (behind the shell), pivoted at the hip
  const legs: Graphics[] = [];
  for (const lx of [-0.32, 0.18]) {
    const leg = new Graphics();
    leg.roundRect(-s * 0.07, 0, s * 0.14, s * 0.3, s * 0.06).fill({
      color: accent,
      alpha: 0.95,
    });
    leg.position.set(lx * s, -s * 0.12);
    container.addChild(leg);
    legs.push(leg);
  }
  // head on a stubby neck, pivoted where the neck leaves the shell
  const head = new Graphics();
  head.ellipse(s * 0.16, -s * 0.05, s * 0.16, s * 0.12).fill({
    color: accent,
    alpha: 0.95,
  });
  head.circle(s * 0.24, -s * 0.08, s * 0.035).fill({ color: 0x2b2823 });
  head.position.set(s * 0.48, -s * 0.28);
  container.addChild(head);
  // domed shell with scute arcs + pale belly rim
  const shell = new Graphics();
  shell.ellipse(0, -s * 0.34, s * 0.52, s * 0.34).fill({ color, alpha: 0.97 });
  for (let i = 0; i < 3; i++) {
    shell
      .moveTo(-s * (0.38 - i * 0.05), -s * (0.3 + i * 0.12))
      .quadraticCurveTo(
        0,
        -s * (0.62 + i * 0.1),
        s * (0.38 - i * 0.05),
        -s * (0.3 + i * 0.12),
      )
      .stroke({
        color: accent,
        width: Math.max(0.7, s * 0.05),
        alpha: 0.7,
      });
  }
  shell
    .roundRect(-s * 0.5, -s * 0.16, s, s * 0.1, s * 0.05)
    .fill({ color: 0xd9c69c, alpha: 0.8 });
  container.addChild(shell);
  return { head, legs };
}

function buildBee(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const wingLeft = new Graphics();
  wingLeft.ellipse(-s * 0.2, -s * 0.2, s * 0.3, s * 0.18).fill({
    color: 0xeaf2f4,
    alpha: 0.55,
  });
  const wingRight = new Graphics();
  wingRight.ellipse(s * 0.2, -s * 0.2, s * 0.3, s * 0.18).fill({
    color: 0xeaf2f4,
    alpha: 0.55,
  });
  const body = new Graphics();
  body.ellipse(0, 0, s * 0.42, s * 0.28).fill({ color, alpha: 0.97 });
  for (let i = -1; i <= 1; i++) {
    body
      .rect(i * s * 0.18 - s * 0.04, -s * 0.22, s * 0.08, s * 0.44)
      .fill({ color: accent, alpha: 0.8 });
  }
  container.addChild(wingLeft, wingRight, body);
  return { wingLeft, wingRight };
}

function buildDragonfly(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  // two pairs of long glassy wings, crossed
  const wingLeft = new Graphics();
  const wingRight = new Graphics();
  for (const [w, sign] of [
    [wingLeft, -1],
    [wingRight, 1],
  ] as const) {
    w.ellipse(sign * s * 0.4, -s * 0.1, s * 0.55, s * 0.14).fill({
      color: 0xdfeef2,
      alpha: 0.5,
    });
    w.ellipse(sign * s * 0.34, s * 0.06, s * 0.48, s * 0.12).fill({
      color: 0xdfeef2,
      alpha: 0.45,
    });
  }
  const body = new Graphics();
  // long thin abdomen
  body.roundRect(-s * 0.1, -s * 0.55, s * 0.2, s * 1.2, s * 0.08).fill({
    color,
    alpha: 0.97,
  });
  body.circle(0, -s * 0.55, s * 0.18).fill({ color: accent, alpha: 0.97 });
  body.circle(s * 0.07, -s * 0.6, s * 0.06).fill({ color: 0x10242a });
  container.addChild(wingLeft, wingRight, body);
  return { wingLeft, wingRight };
}

function buildHeron(
  container: Container,
  s: number,
  color: number,
  accent: number,
): CreatureParts {
  const legs: Graphics[] = [];
  for (const lx of [-0.12, 0.12]) {
    const leg = new Graphics();
    leg.rect(-s * 0.02, 0, s * 0.04, s * 0.7).fill({ color: accent, alpha: 0.9 });
    leg.position.set(lx * s, -s * 0.7);
    container.addChild(leg);
    legs.push(leg);
  }
  const body = new Graphics();
  // plump body
  body.ellipse(0, -s * 0.85, s * 0.32, s * 0.42).fill({ color, alpha: 0.97 });
  // folded wing shading
  body.ellipse(s * 0.06, -s * 0.8, s * 0.24, s * 0.34).fill({
    color: accent,
    alpha: 0.5,
  });
  container.addChild(body);
  // long S-neck + head on a pivot, so it can do a slow head-tilt
  const head = new Graphics();
  head
    .moveTo(0, 0)
    .quadraticCurveTo(-s * 0.35, -s * 0.5, -s * 0.05, -s * 0.95)
    .stroke({ color, width: Math.max(1.5, s * 0.14), alpha: 0.97 });
  head.ellipse(-s * 0.05, -s * 1.0, s * 0.14, s * 0.1).fill({
    color,
    alpha: 0.97,
  });
  // dagger beak
  head
    .poly([-s * 0.16, -s * 1.0, -s * 0.5, -s * 0.92, -s * 0.16, -s * 0.94])
    .fill({ color: 0xd8b24a, alpha: 0.95 });
  head.circle(-s * 0.1, -s * 1.02, s * 0.03).fill({ color: 0x10242a });
  head.position.set(0, -s * 1.2);
  container.addChild(head);
  return { head, legs };
}
