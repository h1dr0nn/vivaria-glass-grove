import { describe, expect, test } from "vitest";
import { mix32, mulberry32, splitSeed, tickRandom } from "./rng";

describe("mulberry32", () => {
  test("produces identical sequences for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  test("produces different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  test("returns values in [0, 1)", () => {
    const rng = mulberry32(999);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("has a roughly uniform mean", () => {
    const rng = mulberry32(42);
    let sum = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) sum += rng();
    expect(sum / n).toBeGreaterThan(0.45);
    expect(sum / n).toBeLessThan(0.55);
  });
});

describe("splitSeed", () => {
  test("is deterministic", () => {
    expect(splitSeed(123, 0)).toBe(splitSeed(123, 0));
    expect(splitSeed(123, 7)).toBe(splitSeed(123, 7));
  });

  test("derives distinct seeds per stream", () => {
    const seeds = new Set(
      Array.from({ length: 32 }, (_, i) => splitSeed(123, i)),
    );
    expect(seeds.size).toBe(32);
  });

  test("derives distinct seeds per master seed", () => {
    expect(splitSeed(1, 0)).not.toBe(splitSeed(2, 0));
  });
});

describe("tickRandom", () => {
  test("is a pure function of (seed, tick, stream)", () => {
    expect(tickRandom(42, 1000, 3)).toBe(tickRandom(42, 1000, 3));
  });

  test("differs across ticks, streams, and seeds", () => {
    expect(tickRandom(42, 1, 0)).not.toBe(tickRandom(42, 2, 0));
    expect(tickRandom(42, 1, 0)).not.toBe(tickRandom(42, 1, 1));
    expect(tickRandom(42, 1, 0)).not.toBe(tickRandom(43, 1, 0));
  });

  test("returns values in [0, 1) and stays well-mixed for huge ticks", () => {
    const ticks = [0, 1, 2 ** 31, 2 ** 32 + 5, 2 ** 40];
    for (const tick of ticks) {
      const v = tickRandom(7, tick, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // huge ticks must not collapse to identical values
    expect(tickRandom(7, 2 ** 32, 0)).not.toBe(tickRandom(7, 0, 0));
  });

  test("has a roughly uniform mean across ticks", () => {
    let sum = 0;
    const n = 10_000;
    for (let t = 0; t < n; t++) sum += tickRandom(42, t, 1);
    expect(sum / n).toBeGreaterThan(0.45);
    expect(sum / n).toBeLessThan(0.55);
  });
});

describe("mix32", () => {
  test("is deterministic and avalanches small input changes", () => {
    expect(mix32(1)).toBe(mix32(1));
    expect(mix32(1)).not.toBe(mix32(2));
    // single-bit input change should flip many output bits
    const diff = (mix32(0) ^ mix32(1)) >>> 0;
    let bits = 0;
    for (let i = 0; i < 32; i++) if ((diff >>> i) & 1) bits++;
    expect(bits).toBeGreaterThan(8);
  });
});
