import { onCleanup, onMount } from "solid-js";
import "./ui/tokens.css";
import "./ui/app.css";
import { createPixiApp, destroyPixiApp, markDirty } from "./render/pixiApp";
import { buildTankView, type TankView } from "./render/tankRenderer";
import { generateTank } from "./sim/tankgen";
import { advanceSim, createInitialSimState } from "./sim/integrate";
import type { SimState } from "./sim/types";

const HOUR_MS = 3_600_000;
const SIM_STEP_MS = 500;
const AMBIENT_STEP_MS = 80;

/** Dev-page parameters (?seed=&land=&simHours=&speed=) until the real UI lands. */
function readParams() {
  const query = new URLSearchParams(window.location.search);
  const num = (key: string, fallback: number): number => {
    const raw = Number.parseFloat(query.get(key) ?? "");
    return Number.isFinite(raw) ? raw : fallback;
  };
  return {
    seed: Math.floor(num("seed", 20260604)),
    land: num("land", 30),
    simHours: num("simHours", 0),
    speed: num("speed", 1),
  };
}

export default function App() {
  let host: HTMLDivElement | undefined;
  let view: TankView | undefined;
  let simInterval: ReturnType<typeof setInterval> | undefined;
  let ambientInterval: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    if (!host) return;
    const params = readParams();

    void (async () => {
      const app = await createPixiApp(host!);
      const tank = generateTank(params.seed, params.land);
      view = buildTankView(app.stage, tank, app.screen.width, app.screen.height);

      let sim: SimState = createInitialSimState(params.seed);
      // dev fast-forward in chunks (catch-up is clamped to 24h by design)
      let remainingMs = params.simHours * HOUR_MS;
      while (remainingMs > 0) {
        const chunk = Math.min(remainingMs, 12 * HOUR_MS);
        sim = advanceSim(sim, chunk, tank.env).state;
        remainingMs -= chunk;
      }
      view.update(sim);
      markDirty();

      // interim dev loop — replaced by the real game loop (task 7)
      simInterval = setInterval(() => {
        if (!view) return;
        sim = advanceSim(sim, SIM_STEP_MS * params.speed, tank.env).state;
        view.update(sim);
        markDirty();
      }, SIM_STEP_MS);

      // ambient motion only while the page is actually visible
      ambientInterval = setInterval(() => {
        if (document.visibilityState !== "visible" || !view) return;
        view.tick(performance.now());
        markDirty();
      }, AMBIENT_STEP_MS);
    })();
  });

  onCleanup(() => {
    clearInterval(simInterval);
    clearInterval(ambientInterval);
    view?.destroy();
    destroyPixiApp();
  });

  return (
    <div class="app-shell">
      <div class="canvas-host" ref={host} />
      <div class="ui-overlay" id="ui" />
    </div>
  );
}
