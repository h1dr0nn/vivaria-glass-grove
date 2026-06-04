import { Container, Graphics } from "pixi.js";
import { mulberry32, splitSeed } from "../../sim/rng";
import { environmentAt } from "../../sim/ecology";
import type { SimState } from "../../sim/types";
import type { TankState } from "../../sim/tankgen";
import { screenX, screenY, type TankLayout } from "../layout";

/**
 * The AIR — small flying life and seasonal drift above the scene. Pure
 * ambient render (no sim authority): density is a function of the season,
 * day/night and how green the world is. This is what makes a long-running
 * tank visibly BREATHE with the seasons — gnats dance on warm afternoons,
 * fireflies glow on summer nights, leaves fall in autumn, petals in spring.
 */

const HOUR_MS = 3_600_000;
const DAY_START_OFFSET_HOURS = 9;
const GNAT_STREAM = 60;
const LEAF_STREAM = 61;
const FIREFLY_STREAM = 62;

/** 1 at midday, 0 deep at night — same wheel the grade uses. */
function daylight(simTimeMs: number): number {
  const hour = (simTimeMs / HOUR_MS + DAY_START_OFFSET_HOURS) % 24;
  if (hour >= 8 && hour < 18) return 1;
  if (hour >= 6 && hour < 8) return (hour - 6) / 2;
  if (hour >= 18 && hour < 20) return 1 - (hour - 18) / 2;
  return 0;
}

interface Mote {
  readonly homeX: number;
  readonly homeY: number;
  readonly phase: number;
  readonly speed: number;
  readonly size: number;
}

export interface AirLayer {
  readonly container: Container;
  update(sim: SimState): void;
  tick(timeMs: number): void;
}

export function buildAir(tank: TankState, layout: TankLayout): AirLayer {
  const container = new Container();
  const precipGfx = new Graphics(); // rain / snow, behind the bugs
  const gnatGfx = new Graphics();
  const fireflyGfx = new Graphics();
  const driftGfx = new Graphics(); // leaves / petals
  container.addChild(precipGfx, driftGfx, gnatGfx, fireflyGfx);

  const gnats = seedMotes(tank, GNAT_STREAM, 18, layout, 0.2, 0.7);
  const fireflies = seedMotes(tank, FIREFLY_STREAM, 12, layout, 0.15, 0.95);
  const drifters = seedMotes(tank, LEAF_STREAM, 9, layout, 0.7, 1.0);
  const precip = seedPrecip(tank, layout, 70);

  let warmth = 0; // 0 winter .. 1 high summer
  let green = 0; // plants scalar
  let day = 1;
  let season: ReturnType<typeof environmentAt>["seasonName"] = "summer";
  let weather: ReturnType<typeof environmentAt>["weather"] = "clear";
  let simTimeMs = 0;

  const update = (sim: SimState): void => {
    const env = environmentAt(sim.seed, sim.simTimeMs);
    season = env.seasonName;
    weather = env.weather;
    warmth = 0.5 + 0.5 * Math.sin(env.seasonPhase * Math.PI * 2); // peak ~summer
    green = sim.scalars.plants;
    day = daylight(sim.simTimeMs);
    simTimeMs = sim.simTimeMs;
  };

  const tick = (timeMs: number): void => {
    const t = timeMs / 1000;
    drawPrecip(precipGfx, precip, layout, t, season, weather);
    drawGnats(gnatGfx, gnats, layout, t, warmth, green, day);
    drawFireflies(fireflyGfx, fireflies, layout, t, warmth, green, day);
    drawDrift(driftGfx, drifters, layout, t, season, green, simTimeMs);
  };

  return { container, update, tick };
}

interface Drop {
  readonly x: number;
  readonly len: number;
  readonly speed: number;
  readonly phase: number;
  /** y of the surface this drop lands on (water line or terrain top), px */
  readonly surfaceY: number;
  /** lands on open water (ripple) vs land (splash) */
  readonly onWater: boolean;
}

/** seeded drops, each ending at ITS column's surface so none fall through */
function seedPrecip(tank: TankState, layout: TankLayout, count: number): Drop[] {
  const rng = mulberry32(splitSeed(tank.seed, 70));
  const drops: Drop[] = [];
  for (let i = 0; i < count; i++) {
    const cellX = 2 + rng() * (tank.width - 4);
    const col = Math.min(tank.width - 1, Math.max(0, Math.round(cellX)));
    const surface = tank.terrainHeight[col];
    const onWater = surface < tank.waterlineY - 1;
    const surfaceCell = onWater ? tank.waterlineY : surface;
    drops.push({
      x: screenX(layout, cellX),
      len: layout.scale * (0.6 + rng() * 0.8),
      speed: 0.6 + rng() * 0.7,
      phase: rng(),
      surfaceY: screenY(layout, surfaceCell),
      onWater,
    });
  }
  return drops;
}

/** rain/snow that STOPS at each column's surface, with a ripple on water or
 *  a splash tick on land — never passing through the ground */
function drawPrecip(
  g: Graphics,
  drops: readonly Drop[],
  layout: TankLayout,
  t: number,
  season: string,
  weather: string,
): void {
  g.clear();
  const raining = weather === "rainy" || weather === "muggy";
  const snowing = season === "winter";
  if (!raining && !snowing) return;
  const top = layout.originY - layout.tankHeightPx;
  const s = layout.scale;

  for (const d of drops) {
    const fall = d.surfaceY - top;
    if (fall <= 0) continue;

    if (snowing && !raining) {
      const cycle = (t * 0.06 * d.speed + d.phase) % 1;
      const y = top + cycle * fall;
      const x = d.x + Math.sin(t * 0.6 + d.phase * 7) * s * 1.2;
      g.circle(x, y, s * 0.18).fill({ color: 0xf4f7fb, alpha: 0.85 });
      // a settled fleck of snow right at the surface
      g.circle(d.x, d.surfaceY - s * 0.1, s * 0.16).fill({
        color: 0xeef4fa,
        alpha: 0.55,
      });
      continue;
    }

    const cycle = (t * 0.95 * d.speed + d.phase) % 1;
    if (cycle < 0.82) {
      const y = top + (cycle / 0.82) * fall;
      g.moveTo(d.x, y)
        .lineTo(d.x - s * 0.4, y + d.len * 3)
        .stroke({ color: 0xbcd6e0, alpha: 0.5, width: Math.max(0.8, s * 0.12) });
    } else {
      const ip = (cycle - 0.82) / 0.18; // 0..1 impact
      if (d.onWater) {
        const r = s * (0.3 + ip * 1.6);
        g.ellipse(d.x, d.surfaceY, r, r * 0.4).stroke({
          color: 0xeaf4f4,
          alpha: 0.45 * (1 - ip),
          width: Math.max(0.7, s * 0.1),
        });
      } else {
        const k = ip * s * 1.2;
        g.circle(d.x - k * 0.5, d.surfaceY - k * 0.7, s * 0.1).fill({
          color: 0xcfe0e6,
          alpha: 0.5 * (1 - ip),
        });
        g.circle(d.x + k * 0.5, d.surfaceY - k * 0.6, s * 0.1).fill({
          color: 0xcfe0e6,
          alpha: 0.5 * (1 - ip),
        });
      }
    }
  }
}

/** seeded home points spread across the air band above the terrain */
function seedMotes(
  tank: TankState,
  stream: number,
  count: number,
  layout: TankLayout,
  lowBand: number,
  highBand: number,
): Mote[] {
  const rng = mulberry32(splitSeed(tank.seed, stream));
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const cellX = 4 + rng() * (tank.width - 8);
    const surface = tank.terrainHeight[Math.min(tank.width - 1, Math.round(cellX))];
    // home Y sits in the air above the local surface, within the usable band
    const bandLow = surface + 2;
    const bandHigh = tank.usableHeight - 2;
    // fill the whole air band, not just a low strip — the empty upper space
    // is exactly where the player expected to see little flyers
    const y = bandLow + (lowBand + rng() * (highBand - lowBand)) * (bandHigh - bandLow);
    motes.push({
      homeX: screenX(layout, cellX),
      homeY: screenY(layout, Math.min(bandHigh, y)),
      phase: rng() * Math.PI * 2,
      speed: 0.6 + rng() * 0.8,
      size: layout.scale * (0.14 + rng() * 0.14),
    });
  }
  return motes;
}

/** lazy gnat swarm — warm daylight only, denser near the green */
function drawGnats(
  g: Graphics,
  motes: readonly Mote[],
  layout: TankLayout,
  t: number,
  warmth: number,
  green: number,
  day: number,
): void {
  g.clear();
  const presence = day * warmth * (0.3 + 0.7 * green);
  if (presence < 0.08) return;
  const visible = Math.floor(motes.length * Math.min(1, presence * 1.3));
  for (let i = 0; i < visible; i++) {
    const m = motes[i];
    // tight figure-eight jitter around the home point
    const x = m.homeX + Math.sin(t * m.speed * 2.1 + m.phase) * layout.scale * 0.9;
    const y =
      m.homeY +
      Math.cos(t * m.speed * 1.7 + m.phase * 1.3) * layout.scale * 0.7 +
      Math.sin(t * 0.3 + m.phase) * layout.scale * 1.5; // slow group bob
    g.circle(x, y, m.size).fill({ color: 0x3a3128, alpha: 0.6 * presence });
  }
}

/** fireflies — warm nights, soft pulsing glow */
function drawFireflies(
  g: Graphics,
  motes: readonly Mote[],
  layout: TankLayout,
  t: number,
  warmth: number,
  green: number,
  day: number,
): void {
  g.clear();
  const night = 1 - day;
  const presence = night * warmth * (0.3 + 0.7 * green);
  if (presence < 0.1) return;
  const visible = Math.floor(motes.length * Math.min(1, presence * 1.3));
  for (let i = 0; i < visible; i++) {
    const m = motes[i];
    const x = m.homeX + Math.sin(t * m.speed * 0.6 + m.phase) * layout.scale * 2.4;
    const y = m.homeY + Math.cos(t * m.speed * 0.5 + m.phase * 1.4) * layout.scale * 1.8;
    // each firefly breathes on its own rhythm — never fully off, so the
    // swarm always reads as present (just twinkling)
    const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.3 + m.phase * 3));
    const glow = blink * presence;
    g.circle(x, y, m.size * 3.2).fill({ color: 0xf6e08a, alpha: 0.3 * glow });
    g.circle(x, y, m.size * 1.5).fill({ color: 0xfff6cc, alpha: 0.95 * glow });
  }
}

/** autumn leaves / spring petals drifting down and swaying */
function drawDrift(
  g: Graphics,
  motes: readonly Mote[],
  layout: TankLayout,
  t: number,
  season: string,
  green: number,
  simTimeMs: number,
): void {
  g.clear();
  const isAutumn = season === "autumn";
  const isSpring = season === "spring";
  if ((!isAutumn && !isSpring) || green < 0.3) return;
  const color = isAutumn ? 0xc98a3c : 0xe8b8c4;
  const fallSpan = layout.scale * 26;
  for (const m of motes) {
    // each flake falls on a slow loop, re-spawning at the top
    const cycle = (t * 0.12 * m.speed + m.phase) % 1;
    const x = m.homeX + Math.sin(t * m.speed + m.phase) * layout.scale * 2.5;
    const y = m.homeY - fallSpan * 0.5 + cycle * fallSpan;
    const spin = Math.sin(t * m.speed * 2 + m.phase);
    const w = m.size * 3;
    const h = m.size * 1.6 * Math.abs(spin);
    g.ellipse(x, y, w, Math.max(m.size * 0.4, h)).fill({
      color,
      alpha: 0.55,
    });
  }
  void simTimeMs;
}
