import { advanceSim } from "../sim/integrate";
import type { EnvSummary, SimEvent, SimState } from "../sim/types";

/**
 * The persistent game loop. Wall-clock authoritative: every tick advances the
 * sim by REAL elapsed time through the single integrate() path, so WebView2
 * timer throttling can never desync the world (docs/ARCHITECTURE.md → Sim).
 * Pauses entirely while hidden; one clamped catch-up runs on return.
 */

export interface GameLoopCallbacks {
  onUpdate(sim: SimState, events: readonly SimEvent[]): void;
  /** fired when the page hides - the right moment to autosave */
  onHidden?(): void;
}

export interface GameLoopOptions {
  /** tick cadence while visible (default 500ms) */
  readonly stepMs?: number;
  /** clock injection for tests (default Date.now) */
  readonly now?: () => number;
  /** skip binding document listeners (tests) */
  readonly bindVisibility?: boolean;
}

export interface GameLoop {
  start(initial: SimState): void;
  stop(): void;
  /** advance by real elapsed time once - exposed for tests */
  tickOnce(): void;
  /** jump the world forward by simulated time (dev boost / future sleep) */
  advanceBy(ms: number): void;
  /** freeze time; resuming never applies the paused span */
  setPaused(paused: boolean): void;
  /** live time multiplier (x1..x10) - never applied to offline catch-up */
  setSpeed(speed: number): void;
  current(): SimState | null;
}

/** spans longer than this are offline catch-up - speed never multiplies them */
const LIVE_SPAN_MS = 5000;

const DEFAULT_STEP_MS = 500;

export function createGameLoop(
  env: EnvSummary,
  callbacks: GameLoopCallbacks,
  options: GameLoopOptions = {},
): GameLoop {
  const stepMs = options.stepMs ?? DEFAULT_STEP_MS;
  const now = options.now ?? Date.now;
  const bindVisibility = options.bindVisibility ?? true;

  let state: SimState | null = null;
  let lastWallMs = 0;
  let interval: ReturnType<typeof setInterval> | undefined;
  let paused = false;
  let speed = 1;

  const tickOnce = (): void => {
    if (!state) return;
    const wallNow = now();
    const elapsed = wallNow - lastWallMs;
    lastWallMs = wallNow;
    if (paused || elapsed <= 0) return;
    // a long gap is offline catch-up: always real-time, never multiplied
    const scaled = elapsed > LIVE_SPAN_MS ? elapsed : elapsed * speed;
    const result = advanceSim(state, scaled, env);
    state = result.state;
    callbacks.onUpdate(state, result.events);
  };

  const startInterval = (): void => {
    if (interval !== undefined) return;
    interval = setInterval(tickOnce, stepMs);
  };

  const stopInterval = (): void => {
    clearInterval(interval);
    interval = undefined;
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      // run the pending slice, persist, then go fully idle (0% CPU)
      tickOnce();
      stopInterval();
      callbacks.onHidden?.();
    } else {
      lastWallMs = lastWallMs === 0 ? now() : lastWallMs;
      tickOnce(); // catch-up for the hidden gap (clamped inside the sim)
      startInterval();
    }
  };

  return {
    start(initial: SimState): void {
      state = initial;
      lastWallMs = now();
      if (bindVisibility) {
        document.addEventListener("visibilitychange", onVisibilityChange);
      }
      startInterval();
    },
    stop(): void {
      stopInterval();
      if (bindVisibility) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      state = null;
    },
    tickOnce,
    setPaused(value: boolean): void {
      if (paused === value) return;
      if (!value) {
        // the paused span must not be replayed on resume
        lastWallMs = now();
      }
      paused = value;
    },
    setSpeed(value: number): void {
      speed = Math.max(1, value);
    },
    advanceBy(ms: number): void {
      if (!state || ms <= 0) return;
      // chunked so the per-call catch-up clamp never truncates the jump
      let remaining = ms;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 12 * 60 * 60 * 1000);
        const result = advanceSim(state, chunk, env);
        state = result.state;
        callbacks.onUpdate(state, result.events);
        remaining -= chunk;
      }
    },
    current(): SimState | null {
      return state;
    },
  };
}
