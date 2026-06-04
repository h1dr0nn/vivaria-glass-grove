/**
 * Dev tool: render generated tanks to PNG for visual inspection.
 * Usage: pnpm exec vite-node scripts/render-tank.ts
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { MATERIAL, ZONE, cellIndex, generateTank } from "../src/sim/tankgen";

const SCALE = 4;

const MATERIAL_COLORS: Record<number, [number, number, number]> = {
  [MATERIAL.air]: [240, 234, 216],
  [MATERIAL.water]: [110, 160, 190],
  [MATERIAL.drainage]: [120, 110, 100],
  [MATERIAL.soil]: [92, 70, 50],
  [MATERIAL.sand]: [205, 185, 140],
  [MATERIAL.litter]: [150, 115, 70],
  [MATERIAL.rock]: [130, 128, 122],
  [MATERIAL.wood]: [105, 75, 48],
};

const ZONE_COLORS: Record<number, [number, number, number]> = {
  [ZONE.none]: [40, 40, 40],
  [ZONE.deepWater]: [30, 60, 120],
  [ZONE.shallows]: [80, 150, 200],
  [ZONE.shore]: [230, 200, 120],
  [ZONE.lowland]: [90, 160, 80],
  [ZONE.midland]: [60, 120, 60],
  [ZONE.highland]: [140, 180, 130],
};

function crc32(buf: Uint8Array): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    raw.set(
      rgb.subarray(y * width * 3, (y + 1) * width * 3),
      y * (width * 3 + 1) + 1,
    );
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function renderGrid(
  grid: Uint8Array,
  width: number,
  height: number,
  palette: Record<number, [number, number, number]>,
): Uint8Array {
  const w = width * SCALE;
  const h = height * SCALE;
  const rgb = new Uint8Array(w * h * 3);
  for (let py = 0; py < h; py++) {
    // PNG rows go top-down; tank rows go bottom-up
    const y = height - 1 - Math.floor(py / SCALE);
    for (let px = 0; px < w; px++) {
      const x = Math.floor(px / SCALE);
      const color = palette[grid[cellIndex(width, x, y)]] ?? [255, 0, 255];
      const i = (py * w + px) * 3;
      rgb[i] = color[0];
      rgb[i + 1] = color[1];
      rgb[i + 2] = color[2];
    }
  }
  return rgb;
}

mkdirSync("tmp", { recursive: true });
for (const land of [0, 15, 30, 50, 75, 100]) {
  const tank = generateTank(20260604, land);
  const w = tank.width * SCALE;
  const h = tank.height * SCALE;
  writeFileSync(
    `tmp/tank-land${land}.png`,
    encodePng(w, h, renderGrid(tank.materials, tank.width, tank.height, MATERIAL_COLORS)),
  );
  writeFileSync(
    `tmp/tank-land${land}-zones.png`,
    encodePng(w, h, renderGrid(tank.zones, tank.width, tank.height, ZONE_COLORS)),
  );
  // eslint-disable-next-line no-console
  console.log(
    `land=${land}: archetype=${tank.archetype} waterlineY=${tank.waterlineY} env=`,
    tank.env,
  );
}
