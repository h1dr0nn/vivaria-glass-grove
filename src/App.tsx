import { Show, onCleanup, onMount } from "solid-js";
import "./ui/tokens.css";
import "./ui/app.css";
import "./ui/panels.css";
import { createPixiApp, destroyPixiApp, getApp, markDirty } from "./render/pixiApp";
import { buildTankView, type TankView } from "./render/tankRenderer";
import { generateTank } from "./sim/tankgen";
import { advanceSim, createInitialSimState } from "./sim/integrate";
import NewTankScreen from "./ui/NewTankScreen";
import Hud from "./ui/Hud";
import Almanac from "./ui/Almanac";
import Toasts from "./ui/Toasts";
import {
  recordEvents,
  resetGameState,
  screen,
  setScreen,
  setSim,
  setTank,
  sim,
  tank,
} from "./ui/store";

const HOUR_MS = 3_600_000;
const SIM_STEP_MS = 500;
const AMBIENT_STEP_MS = 80;

/** Dev-page parameters (?land=&seed=&simHours=&speed=) for visual testing. */
function readDevParams() {
  const query = new URLSearchParams(window.location.search);
  if (!query.has("land") && !query.has("seed")) return null;
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
  let speed = 1;

  const stopLoops = (): void => {
    clearInterval(simInterval);
    clearInterval(ambientInterval);
    simInterval = undefined;
    ambientInterval = undefined;
  };

  const startGame = (seed: number, land: number, simHours = 0): void => {
    stopLoops();
    view?.destroy();

    const newTank = generateTank(seed, land);
    let simState = createInitialSimState(seed);
    // dev fast-forward in chunks (catch-up is clamped to 24h by design);
    // milestones witnessed along the way still land in the journal
    let remainingMs = simHours * HOUR_MS;
    while (remainingMs > 0) {
      const chunk = Math.min(remainingMs, 12 * HOUR_MS);
      const result = advanceSim(simState, chunk, newTank.env);
      simState = result.state;
      recordEvents(result.events);
      remainingMs -= chunk;
    }

    const app = getApp();
    view = buildTankView(app.stage, newTank, app.screen.width, app.screen.height);
    view.update(simState);
    setTank(newTank);
    setSim(simState);
    setScreen("playing");
    markDirty();

    // interim dev loop — replaced by the persistent game loop (task 7)
    simInterval = setInterval(() => {
      if (!view) return;
      const result = advanceSim(simState, SIM_STEP_MS * speed, newTank.env);
      simState = result.state;
      recordEvents(result.events);
      setSim(simState);
      view.update(simState);
      markDirty();
    }, SIM_STEP_MS);

    ambientInterval = setInterval(() => {
      if (document.visibilityState !== "visible" || !view) return;
      view.tick(performance.now());
      markDirty();
    }, AMBIENT_STEP_MS);
  };

  const backToMenu = (): void => {
    stopLoops();
    view?.destroy();
    view = undefined;
    resetGameState();
    setScreen("menu");
    markDirty();
  };

  onMount(() => {
    if (!host) return;
    void (async () => {
      await createPixiApp(host!);
      const dev = readDevParams();
      if (dev) {
        speed = dev.speed;
        startGame(dev.seed, dev.land, dev.simHours);
      }
    })();
  });

  onCleanup(() => {
    stopLoops();
    view?.destroy();
    destroyPixiApp();
  });

  return (
    <div class="app-shell">
      <div class="canvas-host" ref={host} />
      <div class="ui-overlay" id="ui">
        <Show when={screen() === "menu"}>
          <NewTankScreen onStart={(seed, land) => startGame(seed, land)} />
        </Show>
        <Show when={screen() === "playing" && sim() && tank()}>
          <Hud onNewTank={backToMenu} />
          <Almanac />
        </Show>
        <Toasts />
      </div>
    </div>
  );
}
