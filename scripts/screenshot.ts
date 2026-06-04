/**
 * Dev tool: screenshot the running dev server for visual verification.
 * Usage: pnpm exec vite-node scripts/screenshot.ts "land=30&simHours=12" tmp/shot.png
 * Requires `pnpm dev` running on :1420.
 */
import { chromium } from "playwright";

const [query = "", out = "tmp/shot.png"] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
});
const params = new URLSearchParams(query);
await page.goto(`http://localhost:1420/?${query}`, { waitUntil: "load" });
await page.waitForSelector("canvas", { timeout: 15_000 });
// let the first render-on-demand frames land
await page.waitForTimeout(1500);
const clickText = params.get("click");
if (clickText) {
  await page.click(`text=${clickText}`);
  await page.waitForTimeout(600);
}
await page.screenshot({ path: out });
await browser.close();
// eslint-disable-next-line no-console
console.log(`saved ${out} (?${query})`);
