/**
 * Dev tool: PROVE the water surface moves at rest. Takes two frames 1.2s
 * apart and counts differing pixels in the near-line strip and the far-edge
 * strip of the surface band. Both must change.
 * Usage: pnpm exec vite-node scripts/motion-check.ts
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:1420/?land=35&simHours=200");
await page.waitForSelector("canvas");
await page.waitForTimeout(2000);

// strips across open water (land=35, seed default, 1280x800):
// scale≈5.2, originY≈681, waterline row 35 → near line baseY≈499;
// band far edge ≈ baseY + depthY(≈-13.8) ≈ 485
const FRONT = { x: 200, y: 492, width: 400, height: 16 };
const BACK = { x: 200, y: 477, width: 400, height: 13 };

async function grab(clip: typeof FRONT): Promise<Buffer> {
  return page.screenshot({ clip });
}

const frontA = await grab(FRONT);
const backA = await grab(BACK);
await page.waitForTimeout(1200);
const frontB = await grab(FRONT);
const backB = await grab(BACK);
await browser.close();

function diffBytes(a: Buffer, b: Buffer): number {
  let diff = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff + Math.abs(a.length - b.length);
}

const frontDiff = diffBytes(frontA, frontB);
const backDiff = diffBytes(backA, backB);
console.log(`front strip diff: ${frontDiff} bytes`);
console.log(`back strip diff:  ${backDiff} bytes`);

if (frontDiff < 200) {
  console.error("FAIL: near waterline looks frozen");
  process.exit(1);
}
if (backDiff < 200) {
  console.error("FAIL: far band edge looks frozen");
  process.exit(1);
}
console.log("PASS: both surface edges are alive");
