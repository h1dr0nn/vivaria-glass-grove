import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import type { PopulationEntry, SpeciesDef } from "../../sim/species";
import type { TankState } from "../../sim/tankgen";
import { screenX, screenY, type TankLayout } from "../layout";

/**
 * Creatures, drawn from the deterministic population. Counts come from the
 * sim; positions/motion are cosmetic, seeded per species, and advance only
 * in the visible-gated ambient tick. The layer never touches sim state.
 */

const SPAWN_STREAM_BASE = 40;

interface ColumnRange {
  readonly start: number;
  readonly end: number;
}

interface Creature {
  readonly def: SpeciesDef;
  x: number;
  y: number;
  dir: number;
  phase: number;
  speed: number;
  /** hop/burst progress */
  action: number;
}

export interface CreatureLayer {
  readonly container: Container;
  update(population: readonly PopulationEntry[]): void;
  tick(timeMs: number): void;
}

export function buildCreatures(
  tank: TankState,
  layout: TankLayout,
): CreatureLayer {
  const container = new Container();
  const gfx = new Graphics();
  container.addChild(gfx);

  const ranges = computeRanges(tank);
  const creatures = new Map<string, Creature[]>();
  let lastTimeMs = 0;

  const update = (population: readonly PopulationEntry[]): void => {
    const seen = new Set<string>();
    for (const entry of population) {
      seen.add(entry.def.id);
      const flock = creatures.get(entry.def.id) ?? [];
      while (flock.length < entry.count) {
        const spawned = spawn(tank, ranges, entry.def, flock.length);
        if (!spawned) break;
        flock.push(spawned);
      }
      if (flock.length > entry.count) flock.length = entry.count;
      creatures.set(entry.def.id, flock);
    }
    for (const id of creatures.keys()) {
      if (!seen.has(id)) creatures.delete(id);
    }
    draw();
  };

  const tick = (timeMs: number): void => {
    const dt = lastTimeMs === 0 ? 0.08 : Math.min(0.25, (timeMs - lastTimeMs) / 1000);
    lastTimeMs = timeMs;
    for (const flock of creatures.values()) {
      for (const creature of flock) {
        move(creature, tank, ranges, dt, timeMs / 1000);
      }
    }
    draw();
  };

  const draw = (): void => {
    gfx.clear();
    for (const flock of creatures.values()) {
      for (const creature of flock) {
        drawCreature(gfx, layout, creature);
      }
    }
  };

  return { container, update, tick };
}

// ------------------------------------------------------------- habitats

interface Ranges {
  readonly water: ColumnRange | null;
  readonly land: ColumnRange | null;
  readonly shore: ColumnRange | null;
}

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

function computeRanges(tank: TankState): Ranges {
  const water = longestRun(
    tank.terrainHeight.map((h) => h < tank.waterlineY - 1),
  );
  const land = longestRun(tank.terrainHeight.map((h) => h >= tank.waterlineY));
  const shore = longestRun(
    tank.terrainHeight.map(
      (h) => tank.waterlineY > 0 && Math.abs(h - tank.waterlineY) <= 3,
    ),
  );
  return { water, land, shore };
}

function rangeFor(def: SpeciesDef, ranges: Ranges): ColumnRange | null {
  switch (def.habitat) {
    case "water":
    case "floor":
      return ranges.water;
    case "shore":
      return ranges.shore ?? ranges.land;
    case "land":
    case "air":
      return ranges.land;
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
      return surface + 4;
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
  return {
    def,
    x,
    y: homeY(def, tank, x),
    dir: rng() < 0.5 ? -1 : 1,
    phase: rng() * Math.PI * 2,
    speed: 0.6 + rng() * 0.8,
    action: rng(),
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

  switch (c.def.movement) {
    case "drift": {
      c.x += Math.sin(time * 0.4 + c.phase) * dt * 1.2;
      c.y += Math.cos(time * 0.3 + c.phase * 1.7) * dt * 0.9;
      confineWater(c, tank);
      break;
    }
    case "school": {
      // the school shares a slow wandering center; members orbit it
      const center =
        range.start +
        margin +
        ((Math.sin(time * 0.07 + c.def.size) + 1) / 2) *
          (range.end - range.start - margin * 2);
      const targetX = center + Math.sin(c.phase * 5) * 6;
      const dx = targetX - c.x;
      c.dir = Math.abs(dx) < 0.3 ? c.dir : Math.sign(dx);
      c.x += dx * dt * 0.7;
      c.y += Math.sin(time * 0.9 + c.phase * 3) * dt * 1.4;
      confineWater(c, tank);
      break;
    }
    case "crawl": {
      c.x += c.dir * c.speed * dt * 0.7;
      if (c.x < range.start + margin || c.x > range.end - margin) {
        c.dir *= -1;
        c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
      }
      c.y = homeY(c.def, tank, c.x);
      break;
    }
    case "scuttle": {
      c.action -= dt;
      if (c.action <= 0) {
        c.action = 1.2 + Math.sin(c.phase + time) * 0.8 + 1;
        // deterministic flip — seeded phase folded with the burst time
        c.dir = Math.sin(c.phase * 13.7 + time * 3.1) < 0 ? -1 : 1;
      }
      if (c.action > 1) {
        c.x += c.dir * c.speed * dt * 3.2;
        if (c.x < range.start + margin || c.x > range.end - margin) c.dir *= -1;
        c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
      }
      c.y = homeY(c.def, tank, c.x);
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
        // mid-hop: parabolic arc over 0.45s
        const t = -c.action / 0.45;
        c.x += c.dir * c.speed * dt * 5;
        if (c.x < range.start + margin || c.x > range.end - margin) c.dir *= -1;
        c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
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
      if (c.x < range.start + margin || c.x > range.end - margin) {
        c.x = Math.min(range.end - margin, Math.max(range.start + margin, c.x));
      }
      c.dir = Math.cos(time * 0.5 + c.phase) >= 0 ? 1 : -1;
      break;
    }
    default:
      break;
  }
}

function confineWater(c: Creature, tank: TankState): void {
  const column = clampColumn(tank, c.x);
  const floor = tank.terrainHeight[column] + 1;
  const ceiling = tank.waterlineY - 1;
  if (c.y < floor) c.y = floor;
  if (c.y > ceiling) c.y = ceiling;
}

// ---------------------------------------------------------------- draw

function drawCreature(g: Graphics, layout: TankLayout, c: Creature): void {
  const px = screenX(layout, c.x);
  const py = screenY(layout, c.y);
  const s = layout.scale * c.def.size;
  const { color, accent } = c.def;

  switch (c.def.id) {
    case "ember-tetra":
    case "dwarf-cory":
      drawFish(g, px, py, s, c.dir, color, accent);
      break;
    case "cherry-shrimp":
      drawShrimp(g, px, py, s, c.dir, color, accent);
      break;
    case "ramshorn-snail":
    case "moss-snail":
      drawSnail(g, px, py, s, c.dir, color, accent);
      break;
    case "fiddler-crab":
      drawCrab(g, px, py, s, c.dir, color, accent);
      break;
    case "froglet":
      drawFrog(g, px, py, s, c.dir, color, accent);
      break;
    case "dwarf-isopod":
    case "leaf-beetle":
      drawBug(g, px, py, s, color, accent);
      break;
    case "meadow-moth":
      drawMoth(g, px, py, s, c.phase, color, accent);
      break;
    case "detritus-worm":
      drawWorm(g, px, py, s, c.phase, color);
      break;
    default:
      g.circle(px, py, Math.max(1, s * 0.5)).fill({ color, alpha: 0.9 });
      break;
  }
}

function drawFish(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  dir: number,
  color: number,
  accent: number,
): void {
  g.ellipse(x, y, s * 0.9, s * 0.45).fill({ color, alpha: 0.95 });
  // tail
  g.poly([
    x - dir * s * 0.8,
    y,
    x - dir * s * 1.35,
    y - s * 0.4,
    x - dir * s * 1.35,
    y + s * 0.4,
  ]).fill({ color: accent, alpha: 0.9 });
  // eye
  g.circle(x + dir * s * 0.45, y - s * 0.08, Math.max(0.7, s * 0.1)).fill({
    color: 0x2b2823,
    alpha: 0.9,
  });
}

function drawShrimp(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  dir: number,
  color: number,
  accent: number,
): void {
  // arched body of segments
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    g.circle(
      x - dir * (t - 0.4) * s * 1.2,
      y - Math.sin(t * Math.PI) * s * 0.35,
      s * (0.32 - t * 0.06),
    ).fill({ color: i % 2 === 0 ? color : accent, alpha: 0.95 });
  }
  // tail fan
  g.circle(x - dir * s * 0.85, y + s * 0.05, s * 0.18).fill({
    color: accent,
    alpha: 0.9,
  });
}

function drawSnail(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  dir: number,
  color: number,
  accent: number,
): void {
  // foot
  g.ellipse(x, y - s * 0.12, s * 0.75, s * 0.22).fill({
    color: accent,
    alpha: 0.9,
  });
  // shell
  g.circle(x - dir * s * 0.15, y - s * 0.55, s * 0.45).fill({
    color,
    alpha: 0.95,
  });
  g.circle(x - dir * s * 0.15, y - s * 0.55, s * 0.22).stroke({
    color: accent,
    width: Math.max(0.8, s * 0.1),
    alpha: 0.7,
  });
}

function drawCrab(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  dir: number,
  color: number,
  accent: number,
): void {
  g.ellipse(x, y - s * 0.3, s * 0.6, s * 0.4).fill({ color, alpha: 0.95 });
  // legs
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const lx = x + side * s * (0.5 + i * 0.16);
      g.moveTo(x + side * s * 0.4, y - s * 0.25)
        .lineTo(lx, y + s * 0.05)
        .stroke({ color: accent, width: Math.max(0.8, s * 0.08), alpha: 0.85 });
    }
  }
  // the famous big claw
  g.circle(x + dir * s * 0.75, y - s * 0.5, s * 0.3).fill({
    color: accent,
    alpha: 0.95,
  });
  // eye stalks
  g.circle(x - s * 0.15, y - s * 0.72, s * 0.08).fill({ color: 0x2b2823 });
  g.circle(x + s * 0.15, y - s * 0.72, s * 0.08).fill({ color: 0x2b2823 });
}

function drawFrog(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  dir: number,
  color: number,
  accent: number,
): void {
  // haunches + body lean in travel direction
  g.ellipse(x - dir * s * 0.2, y - s * 0.25, s * 0.42, s * 0.35).fill({
    color: accent,
    alpha: 0.95,
  });
  g.ellipse(x + dir * s * 0.15, y - s * 0.4, s * 0.45, s * 0.3).fill({
    color,
    alpha: 0.95,
  });
  // eye bump
  g.circle(x + dir * s * 0.45, y - s * 0.62, s * 0.12).fill({ color });
  g.circle(x + dir * s * 0.48, y - s * 0.64, s * 0.05).fill({
    color: 0x2b2823,
  });
  // front leg
  g.moveTo(x + dir * s * 0.35, y - s * 0.15)
    .lineTo(x + dir * s * 0.45, y)
    .stroke({ color: accent, width: Math.max(0.8, s * 0.1), alpha: 0.9 });
}

function drawBug(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  color: number,
  accent: number,
): void {
  g.ellipse(x, y - s * 0.2, s * 0.5, s * 0.3).fill({ color, alpha: 0.95 });
  g.moveTo(x - s * 0.45, y - s * 0.2)
    .lineTo(x + s * 0.45, y - s * 0.2)
    .stroke({ color: accent, width: Math.max(0.6, s * 0.06), alpha: 0.6 });
}

function drawMoth(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  phase: number,
  color: number,
  accent: number,
): void {
  const flap = Math.abs(Math.sin(performance.now() / 90 + phase));
  g.ellipse(x - s * 0.35, y, s * 0.4, s * (0.18 + flap * 0.3)).fill({
    color,
    alpha: 0.95,
  });
  g.ellipse(x + s * 0.35, y, s * 0.4, s * (0.18 + flap * 0.3)).fill({
    color,
    alpha: 0.95,
  });
  g.ellipse(x, y, s * 0.12, s * 0.3).fill({ color: accent, alpha: 0.95 });
}

function drawWorm(
  g: Graphics,
  x: number,
  y: number,
  s: number,
  phase: number,
  color: number,
): void {
  const t = performance.now() / 600 + phase;
  g.moveTo(x - s * 0.5, y);
  for (let i = 1; i <= 4; i++) {
    const wx = x - s * 0.5 + (i / 4) * s;
    g.lineTo(wx, y + Math.sin(t * 2 + i) * s * 0.18);
  }
  g.stroke({ color, width: Math.max(0.8, s * 0.18), alpha: 0.85 });
}
