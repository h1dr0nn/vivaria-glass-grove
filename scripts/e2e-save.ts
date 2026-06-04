/**
 * Dev tool: end-to-end save/continue check against the dev server.
 * Flow: start a world via dev params → reload plain → Continue card must
 * exist → click it → HUD must show the same world, advanced.
 */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const fail = async (message: string): Promise<never> => {
  await page.screenshot({ path: "tmp/e2e-save-failure.png" });
  await browser.close();
  console.error(`E2E FAIL: ${message}`);
  process.exit(1);
};

// 1. fresh world via dev params (persists immediately)
await page.goto("http://localhost:1420/?land=40&seed=777&simHours=30");
await page.waitForSelector("canvas");
await page.waitForTimeout(1500);
const hudText = await page.locator(".hud-card").textContent();
if (!hudText?.includes("Paludarium")) {
  await fail(`expected HUD with Paludarium, got: ${hudText}`);
}

// 2. plain reload → menu with Continue card
await page.goto("http://localhost:1420/");
await page.waitForSelector(".menu-panel", { timeout: 10_000 });
const continueCard = page.locator(".continue-card");
if ((await continueCard.count()) === 0) {
  await fail("no Continue card after reload - save not found");
}
const cardText = await continueCard.textContent();
if (!cardText?.includes("40% land")) {
  await fail(`Continue card missing world identity: ${cardText}`);
}
await page.screenshot({ path: "tmp/e2e-menu-continue.png" });

// 3. continue → same world restored
await continueCard.click();
await page.waitForSelector(".hud-card", { timeout: 10_000 });
const restoredHud = await page.locator(".hud-card").textContent();
if (!restoredHud?.includes("Paludarium")) {
  await fail(`restored HUD wrong: ${restoredHud}`);
}
// journal must carry the witnessed milestones through the save
await page.click("text=Almanac");
await page.waitForTimeout(400);
const progress = await page.locator(".almanac-progress").textContent();
if (!progress || progress.startsWith("0 /")) {
  await fail(`journal lost discoveries: ${progress}`);
}
await page.screenshot({ path: "tmp/e2e-continued.png" });

await browser.close();
console.log(
  `E2E PASS - continue card: "${cardText}" | restored: "${restoredHud}" | journal: "${progress}"`,
);
