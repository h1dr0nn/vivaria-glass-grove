/**
 * Dev tool: verify the G time-skip cheat spawns life.
 * Usage: pnpm exec vite-node scripts/check-timeskip.ts
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:1420/?land=35&simHours=1&seed=4242");
await page.waitForSelector(".hud-card");
await page.waitForTimeout(800);

const before = await page.locator(".hud-card").textContent();
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("g");
  await page.waitForTimeout(250);
}
const after = await page.locator(".hud-card").textContent();
await page.click("text=Almanac");
await page.waitForTimeout(400);
const journal = await page.locator(".almanac-progress").textContent();
await page.screenshot({ path: "tmp/shot-timeskip.png" });
await browser.close();

console.log(`before: ${before}`);
console.log(`after:  ${after}`);
console.log(`journal: ${journal}`);
if (before === after) {
  console.error("FAIL: G key did not advance the world");
  process.exit(1);
}
console.log("PASS: time skip works");
