/**
 * Window-motion tracker: turns window drags into slosh impulses.
 * Tauri: onMoved events (PHYSICAL px → CSS px via scaleFactor), which arrive
 * bursty during the Win32 modal drag loop - so every event is self-timestamped
 * and velocity is EMA-smoothed. Browser dev: screenX/Y polling fallback.
 */

interface WindowMotionOptions {
  /** horizontal/vertical window acceleration in CSS px/s² */
  onImpulse(ax: number, ay: number): void;
}

export interface WindowMotionTracker {
  dispose(): void;
}

const SMOOTH_TAU_S = 0.06;
/** a single-event jump bigger than this is a teleport (snap/maximize) */
const JUMP_LIMIT_PX = 600;
/** minimized windows park near -32000 - not a real move */
const MINIMIZED_COORD = 30000;
/** stale-gap: events further apart than this don't form a velocity */
const GAP_RESET_MS = 250;
const POLL_MS = 80;

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function createWindowMotionTracker(
  options: WindowMotionOptions,
): WindowMotionTracker {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let lastT = 0;
  let vx = 0;
  let vy = 0;

  const feed = (x: number, y: number): void => {
    if (Math.abs(x) > MINIMIZED_COORD || Math.abs(y) > MINIMIZED_COORD) {
      lastX = Number.NaN; // minimize park - reset tracking
      vx = 0;
      vy = 0;
      return;
    }
    const t = performance.now();
    if (Number.isNaN(lastX) || t - lastT > GAP_RESET_MS) {
      lastX = x;
      lastY = y;
      lastT = t;
      vx = 0;
      vy = 0;
      return;
    }
    const dx = x - lastX;
    const dy = y - lastY;
    const dtSec = Math.max(0.001, (t - lastT) / 1000);
    lastX = x;
    lastY = y;
    lastT = t;
    if (Math.abs(dx) > JUMP_LIMIT_PX || Math.abs(dy) > JUMP_LIMIT_PX) {
      // teleport (snap / restore) - a gentle capped plop, not a tsunami
      vx = 0;
      vy = 0;
      options.onImpulse(0, 800);
      return;
    }
    const rawVx = dx / dtSec;
    const rawVy = dy / dtSec;
    const alpha = 1 - Math.exp(-dtSec / SMOOTH_TAU_S);
    const prevVx = vx;
    const prevVy = vy;
    vx += alpha * (rawVx - vx);
    vy += alpha * (rawVy - vy);
    options.onImpulse((vx - prevVx) / dtSec, (vy - prevVy) / dtSec);
  };

  if (isTauri()) {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        let scale = await win.scaleFactor();
        const unScale = await win.onScaleChanged(({ payload }) => {
          scale = payload.scaleFactor;
          lastX = Number.NaN; // physical coords jump with the scale - discard
        });
        const unMove = await win.onMoved(({ payload }) => {
          feed(payload.x / scale, payload.y / scale);
        });
        if (disposed) {
          unMove();
          unScale();
          return;
        }
        unlisten = () => {
          unMove();
          unScale();
        };
      } catch (error: unknown) {
        console.error("window motion tracking unavailable", error);
      }
    })();
  } else if (Number.isFinite(window.screenX)) {
    pollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      feed(window.screenX, window.screenY);
    }, POLL_MS);
  }

  return {
    dispose(): void {
      disposed = true;
      unlisten?.();
      unlisten = null;
      clearInterval(pollTimer);
    },
  };
}
