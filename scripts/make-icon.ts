/**
 * Dev tool: generate the app icon (a cozy terrarium jar) as a 1024 RGBA PNG.
 * Usage: pnpm exec vite-node scripts/make-icon.ts && pnpm tauri icon app-icon.png
 */
import { writeFileSync } from "node:fs";
import { encodePngRgba } from "./lib/png";

const SIZE = 1024;

// jar bounds
const JX0 = 152;
const JX1 = 872;
const JY0 = 168;
const JY1 = 900;
const RADIUS = 110;
const BORDER = 18;

const COLORS = {
  glassEdge: [223, 232, 218, 255],
  glassAir: [244, 238, 222, 235],
  water: [127, 178, 196, 255],
  waterDeep: [73, 125, 153, 255],
  waterLine: [232, 244, 240, 255],
  soil: [93, 71, 52, 255],
  soilDark: [76, 58, 43, 255],
  sand: [217, 198, 156, 255],
  stem: [79, 122, 61, 255],
  leaf: [118, 168, 92, 255],
  leafLight: [151, 194, 119, 255],
  moss: [95, 138, 74, 255],
  fish: [224, 138, 60, 255],
} as const;

type Color = readonly [number, number, number, number];

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** distance from the jar edge, positive inside, negative outside */
function insideJar(x: number, y: number): number {
  // distance from edge, positive inside
  if (x < JX0 || x > JX1 || y < JY0 || y > JY1) return -1;
  const dx = Math.min(x - JX0, JX1 - x);
  const dy = Math.min(y - JY0, JY1 - y);
  if (dx >= RADIUS || dy >= RADIUS) return Math.min(dx, dy);
  // corner region
  const corner = RADIUS - Math.hypot(RADIUS - dx, RADIUS - dy);
  return corner;
}

const WATER_LEVEL = 0.42; // from jar bottom
const pixels = new Uint8Array(SIZE * SIZE * 4);

function put(x: number, y: number, color: Color): void {
  const i = (y * SIZE + x) * 4;
  pixels[i] = color[0];
  pixels[i + 1] = color[1];
  pixels[i + 2] = color[2];
  pixels[i + 3] = color[3];
}

function terrainAt(u: number): number {
  // gentle basin left, rising bank right (mirrors the game's riverbank)
  return 0.14 + 0.5 * smoothstep((u - 0.42) / 0.34);
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const inside = insideJar(x, y);
    if (inside < 0) continue; // transparent
    if (inside < BORDER) {
      put(x, y, COLORS.glassEdge);
      continue;
    }
    const u = (x - JX0) / (JX1 - JX0);
    const fromBottom = (JY1 - y) / (JY1 - JY0);
    const terrain = terrainAt(u);

    if (fromBottom < terrain) {
      if (terrain - fromBottom < 0.035) {
        put(x, y, COLORS.sand);
      } else {
        put(x, y, fromBottom < WATER_LEVEL ? COLORS.soilDark : COLORS.soil);
      }
    } else if (fromBottom < WATER_LEVEL) {
      const depth = (WATER_LEVEL - fromBottom) / WATER_LEVEL;
      const mix = (a: number, b: number): number =>
        Math.round(a + (b - a) * depth);
      put(x, y, [
        mix(COLORS.water[0], COLORS.waterDeep[0]),
        mix(COLORS.water[1], COLORS.waterDeep[1]),
        mix(COLORS.water[2], COLORS.waterDeep[2]),
        255,
      ]);
      if (WATER_LEVEL - fromBottom < 0.012 && terrain < fromBottom) {
        put(x, y, COLORS.waterLine);
      }
    } else {
      put(x, y, COLORS.glassAir);
    }
  }
}

/** stamp a filled circle */
function circle(cx: number, cy: number, r: number, color: Color): void {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && insideJar(x, y) >= BORDER) {
        put(x, y, color);
      }
    }
  }
}

// the sprout on the bank - the icon's heart
const sproutU = 0.72;
const sproutX = JX0 + sproutU * (JX1 - JX0);
const groundY = JY1 - terrainAt(sproutU) * (JY1 - JY0);
const stemTop = groundY - 240;
for (let t = 0; t <= 1; t += 0.004) {
  const sx = sproutX + Math.sin(t * 1.2) * 26 * t;
  const sy = groundY + (stemTop - groundY) * t;
  circle(sx, sy, 13 - t * 4, COLORS.stem);
}
circle(sproutX - 78, stemTop + 92, 64, COLORS.leaf);
circle(sproutX - 48, stemTop + 70, 42, COLORS.leafLight);
circle(sproutX + 102, stemTop + 40, 72, COLORS.leaf);
circle(sproutX + 68, stemTop + 18, 46, COLORS.leafLight);
circle(sproutX + 34, stemTop - 18, 30, COLORS.leafLight);

// moss tufts on the bank
circle(JX0 + 0.62 * (JX1 - JX0), JY1 - terrainAt(0.62) * (JY1 - JY0) + 8, 34, COLORS.moss);
circle(JX0 + 0.88 * (JX1 - JX0), JY1 - terrainAt(0.88) * (JY1 - JY0) + 6, 42, COLORS.moss);

// a tiny fish in the water
const fishX = JX0 + 0.22 * (JX1 - JX0);
const fishY = JY1 - 0.26 * (JY1 - JY0);
circle(fishX, fishY, 26, COLORS.fish);
circle(fishX - 34, fishY, 14, COLORS.fish);

writeFileSync("app-icon.png", encodePngRgba(SIZE, SIZE, pixels));
// eslint-disable-next-line no-console
console.log("wrote app-icon.png (1024x1024 RGBA)");
