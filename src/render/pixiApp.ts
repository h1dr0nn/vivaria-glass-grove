import { Application, Container } from "pixi.js";

/**
 * Pixi bootstrap with render-on-demand.
 *
 * ARCHITECTURE CONTRACT (docs/ARCHITECTURE.md):
 * - No free-running rAF loop. A frame is rendered ONLY when something marked
 *   the scene dirty. A still-but-visible tank must render <5 fps; idle = 0.
 * - WebGL pinned (WebView2 stability) — never auto-detect to WebGPU.
 * - This module owns the Application lifecycle and is HMR-safe: the GL
 *   context is disposed before module replacement (no context leak).
 */

let app: Application | null = null;
let pendingFrame: number | null = null;

/** Root container the scene graph hangs off (survives scene swaps). */
export function getStage(): Container {
  if (!app) {
    throw new Error("Pixi app not initialized — call createPixiApp first");
  }
  return app.stage;
}

export function getApp(): Application {
  if (!app) {
    throw new Error("Pixi app not initialized — call createPixiApp first");
  }
  return app;
}

/**
 * Request a render on the next animation frame. Coalesces multiple calls.
 * This is the ONLY way a frame gets drawn — there is no automatic ticker.
 */
export function markDirty(): void {
  if (!app || pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = null;
    app?.render();
  });
}

export async function createPixiApp(host: HTMLElement): Promise<Application> {
  if (app) return app;

  const created = new Application();
  await created.init({
    preference: "webgl",
    background: "#2b2823",
    resizeTo: host,
    antialias: true,
    autoStart: false,
    sharedTicker: false,
  });
  created.ticker.stop();

  host.appendChild(created.canvas);
  app = created;

  // Re-render once on host resize (debounced by rAF coalescing).
  const resizeObserver = new ResizeObserver(() => markDirty());
  resizeObserver.observe(host);
  disposeResizeObserver = () => resizeObserver.disconnect();

  markDirty();
  return created;
}

let disposeResizeObserver: (() => void) | null = null;

export function destroyPixiApp(): void {
  if (pendingFrame !== null) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }
  disposeResizeObserver?.();
  disposeResizeObserver = null;
  if (app) {
    app.destroy(true, { children: true, texture: true });
    app = null;
  }
}

// HMR: dispose the GL context before replacement, then hard-reload so the
// scene rebuilds from scratch (prevents WebGL context leaks during dev).
if (import.meta.hot) {
  import.meta.hot.dispose(() => destroyPixiApp());
  import.meta.hot.accept(() => window.location.reload());
}
