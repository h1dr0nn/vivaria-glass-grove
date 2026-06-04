import { describe, expect, test } from "vitest";
import { DEFAULT_TUNABLES, hashTunables } from "./tunables";

describe("hashTunables", () => {
  test("is stable for the same tunables", () => {
    expect(hashTunables(DEFAULT_TUNABLES)).toBe(hashTunables(DEFAULT_TUNABLES));
  });

  test("returns an 8-char hex string", () => {
    expect(hashTunables(DEFAULT_TUNABLES)).toMatch(/^[0-9a-f]{8}$/);
  });

  test("changes when any balance value changes", () => {
    const tweaked = {
      ...DEFAULT_TUNABLES,
      nutrientYieldPerHour: DEFAULT_TUNABLES.nutrientYieldPerHour + 0.01,
    };
    expect(hashTunables(tweaked)).not.toBe(hashTunables(DEFAULT_TUNABLES));
  });

  test("changes when a nested tier value changes", () => {
    const tweaked = {
      ...DEFAULT_TUNABLES,
      plants: {
        ...DEFAULT_TUNABLES.plants,
        growthRatePerHour: DEFAULT_TUNABLES.plants.growthRatePerHour * 2,
      },
    };
    expect(hashTunables(tweaked)).not.toBe(hashTunables(DEFAULT_TUNABLES));
  });
});
