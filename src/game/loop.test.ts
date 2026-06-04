import { describe, expect, test, vi } from "vitest";
import { advanceSim, createInitialSimState } from "../sim/integrate";
import type { EnvSummary, SimState } from "../sim/types";
import { createGameLoop } from "./loop";

const ENV: EnvSummary = { light: 0.7, moisture: 0.75, waterFraction: 0.7 };
const HOUR_MS = 3_600_000;

function makeClock(startMs: number) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createGameLoop", () => {
  test("tickOnce advances the sim by real elapsed wall time", () => {
    const clock = makeClock(1_000_000);
    const updates: SimState[] = [];
    const loop = createGameLoop(
      ENV,
      { onUpdate: (s) => updates.push(s) },
      { now: clock.now, bindVisibility: false },
    );

    const initial = createInitialSimState(42);
    loop.start(initial);
    clock.advance(2 * HOUR_MS);
    loop.tickOnce();

    expect(updates).toHaveLength(1);
    const expected = advanceSim(initial, 2 * HOUR_MS, ENV).state;
    expect(updates[0]).toEqual(expected);
    loop.stop();
  });

  test("multiple ticks equal one batched advance (loop preserves determinism)", () => {
    const clock = makeClock(5_000_000);
    const loop = createGameLoop(
      ENV,
      { onUpdate: () => undefined },
      { now: clock.now, bindVisibility: false },
    );
    const initial = createInitialSimState(7);
    loop.start(initial);
    for (let i = 0; i < 10; i++) {
      clock.advance(13 * 60_000 + i * 7);
      loop.tickOnce();
    }
    const total = 10 * 13 * 60_000 + 7 * 45; // sum of the advances above
    const batched = advanceSim(initial, total, ENV).state;
    expect(loop.current()).toEqual(batched);
    loop.stop();
  });

  test("zero elapsed does not emit updates", () => {
    const clock = makeClock(0);
    const onUpdate = vi.fn();
    const loop = createGameLoop(
      ENV,
      { onUpdate },
      { now: clock.now, bindVisibility: false },
    );
    loop.start(createInitialSimState(1));
    loop.tickOnce();
    expect(onUpdate).not.toHaveBeenCalled();
    loop.stop();
  });

  test("stop clears state", () => {
    const clock = makeClock(0);
    const loop = createGameLoop(
      ENV,
      { onUpdate: () => undefined },
      { now: clock.now, bindVisibility: false },
    );
    loop.start(createInitialSimState(1));
    expect(loop.current()).not.toBeNull();
    loop.stop();
    expect(loop.current()).toBeNull();
  });

  test("events from a long catch-up reach the callback", () => {
    const clock = makeClock(0);
    const allEvents: string[] = [];
    const loop = createGameLoop(
      ENV,
      {
        onUpdate: (_s, events) => {
          allEvents.push(...events.map((e) => e.phase));
        },
      },
      { now: clock.now, bindVisibility: false },
    );
    loop.start(createInitialSimState(42));
    clock.advance(24 * HOUR_MS); // a full day away (clamp boundary)
    loop.tickOnce();
    expect(allEvents).toContain("microbes");
    loop.stop();
  });
});
