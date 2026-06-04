import { describe, expect, test } from "vitest";
import { advanceSim, createInitialSimState } from "../sim/integrate";
import { generateTank } from "../sim/tankgen";
import { buildSave, parseSave, restoreSim } from "./saves";
import { CURRENT_SAVE_VERSION } from "./saveSchema";

const HOUR_MS = 3_600_000;

function makeSave() {
  const tank = generateTank(42, 30);
  let sim = createInitialSimState(42);
  sim = advanceSim(sim, 6 * HOUR_MS, tank.env).state;
  const discoveries = [{ phase: "microbes" as const, atSimTimeMs: 60_000 }];
  return { tank, sim, save: buildSave(tank, sim, discoveries, 1_750_000_000_000) };
}

describe("save round-trip", () => {
  test("buildSave → JSON → parseSave → restoreSim reproduces the sim exactly", () => {
    const { sim, save } = makeSave();
    const parsed = parseSave(JSON.stringify(save));
    expect(parsed).not.toBeNull();
    expect(restoreSim(parsed!)).toEqual(sim);
  });

  test("save carries world identity for deterministic regeneration", () => {
    const { tank, save } = makeSave();
    expect(save.seed).toBe(tank.seed);
    expect(save.landPercent).toBe(tank.landPercent);
    expect(save.genVersion).toBe(tank.genVersion);
    expect(save.schemaVersion).toBe(CURRENT_SAVE_VERSION);
    expect(save.tunablesHash).toMatch(/^[0-9a-f]{8}$/);
  });

  test("restored sim continues identically to the original", () => {
    const { tank, sim, save } = makeSave();
    const restored = restoreSim(parseSave(JSON.stringify(save))!);
    const a = advanceSim(sim, 3 * HOUR_MS, tank.env);
    const b = advanceSim(restored, 3 * HOUR_MS, tank.env);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });
});

describe("parseSave — untrusted input", () => {
  test("rejects malformed JSON", () => {
    expect(parseSave("{ not json")).toBeNull();
    expect(parseSave("")).toBeNull();
    expect(parseSave("null")).toBeNull();
    expect(parseSave("42")).toBeNull();
  });

  test("rejects wrong shapes", () => {
    expect(parseSave("{}")).toBeNull();
    expect(parseSave(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
  });

  test("rejects out-of-range values", () => {
    const { save } = makeSave();
    const tampered = { ...save, landPercent: 250 };
    expect(parseSave(JSON.stringify(tampered))).toBeNull();
    const negativeTime = {
      ...save,
      sim: { ...save.sim, simTimeMs: -5 },
    };
    expect(parseSave(JSON.stringify(negativeTime))).toBeNull();
  });

  test("rejects versions from the future or before v1", () => {
    const { save } = makeSave();
    expect(
      parseSave(JSON.stringify({ ...save, schemaVersion: 999 })),
    ).toBeNull();
    expect(parseSave(JSON.stringify({ ...save, schemaVersion: 0 }))).toBeNull();
  });
});
