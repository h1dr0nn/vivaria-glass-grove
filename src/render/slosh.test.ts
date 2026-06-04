import { describe, expect, test } from "vitest";
import { createSlosh } from "./slosh";

describe("slosh spring", () => {
  test("sleeps until an impulse arrives", () => {
    const slosh = createSlosh();
    expect(slosh.isAwake()).toBe(false);
    slosh.step(0.5);
    expect(slosh.read().tilt).toBe(0);
    expect(slosh.read().wave).toBe(0);
  });

  test("wakes on impulse and visibly deflects", () => {
    const slosh = createSlosh();
    slosh.impulse(3000, 0);
    expect(slosh.isAwake()).toBe(true);
    slosh.step(0.08);
    expect(Math.abs(slosh.read().tilt)).toBeGreaterThan(0);
  });

  test("settles back to sleep within ~3 seconds", () => {
    const slosh = createSlosh();
    slosh.impulse(5000, 1000);
    for (let t = 0; t < 3; t += 0.08) {
      slosh.step(0.08);
    }
    expect(slosh.isAwake()).toBe(false);
    expect(slosh.read().tilt).toBe(0);
    expect(slosh.read().bob).toBe(0);
  });

  test("energy decays monotonically after the impulse", () => {
    const slosh = createSlosh();
    slosh.impulse(4000, 0);
    let lastPeak = Number.POSITIVE_INFINITY;
    // sample peak |tilt| over successive half-periods (~0.45s)
    for (let cycle = 0; cycle < 4; cycle++) {
      let peak = 0;
      for (let t = 0; t < 0.45; t += 0.04) {
        slosh.step(0.04);
        peak = Math.max(peak, Math.abs(slosh.read().tilt));
      }
      expect(peak).toBeLessThanOrEqual(lastPeak + 1e-9);
      lastPeak = peak;
    }
  });

  test("a violent impulse stays clamped (surface never tears)", () => {
    const slosh = createSlosh();
    slosh.impulse(1e9, 1e9);
    for (let t = 0; t < 1; t += 0.05) {
      slosh.step(0.05);
      const r = slosh.read();
      expect(Math.abs(r.tilt)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(r.wave).toBeLessThanOrEqual(1);
      expect(Math.abs(r.bob)).toBeLessThanOrEqual(1);
    }
  });

  test("opposite impulses cancel", () => {
    const slosh = createSlosh();
    slosh.impulse(2500, 0);
    slosh.impulse(-2500, 0);
    slosh.step(0.1);
    expect(Math.abs(slosh.read().tilt)).toBeLessThan(0.002);
  });
});
