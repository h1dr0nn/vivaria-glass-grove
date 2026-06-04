import { Show, createSignal, onCleanup, onMount } from "solid-js";
import "./ui/tokens.css";
import "./ui/app.css";
import "./ui/panels.css";
import { createPixiApp, destroyPixiApp, getApp, markDirty } from "./render/pixiApp";
import { buildTankView, type TankView } from "./render/tankRenderer";
import { generateTank, type TankState } from "./sim/tankgen";
import { advanceSim, createInitialSimState } from "./sim/integrate";
import { populationFor } from "./sim/species";
import type { SimEvent, SimState } from "./sim/types";
import { createGameLoop, type GameLoop } from "./game/loop";
import {
  createWindowMotionTracker,
  type WindowMotionTracker,
} from "./render/windowMotion";
import {
  bindAudioVisibility,
  loadMutePreference,
  playChime,
  startAmbient,
  stopAmbient,
} from "./audio/engine";
import { createStorage } from "./persistence/storage";
import { buildSave, parseSave, restoreSim } from "./persistence/saves";
import type { SaveData } from "./persistence/saveSchema";
import NewTankScreen from "./ui/NewTankScreen";
import Hud from "./ui/Hud";
import Almanac from "./ui/Almanac";
import Toasts from "./ui/Toasts";
import {
  announceDiscoveries,
  discoveries,
  pushToast,
  recordEvents,
  recordSightings,
  resetGameState,
  savedGame,
  screen,
  setDiscoveries,
  setSavedGame,
  setScreen,
  setSim,
  setSpeciesDiscovered,
  setTank,
  setTimePaused,
  setTimeSpeed,
  sim,
  speciesDiscovered,
  tank,
} from "./ui/store";
import { DEFAULT_TUNABLES, hashTunables } from "./sim/tunables";

const HOUR_MS = 3_600_000;
const AMBIENT_STEP_MS = 80;
const AUTOSAVE_MS = 60_000;

/** Dev-page parameters (?land=&seed=&simHours=&speed=) for visual testing. */
function readDevParams() {
  if (!import.meta.env.DEV) return null; // never in shipped builds
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
  let loop: GameLoop | undefined;
  let ambientInterval: ReturnType<typeof setInterval> | undefined;
  let autosaveInterval: ReturnType<typeof setInterval> | undefined;
  let activeTank: TankState | null = null;
  let motionTracker: WindowMotionTracker | undefined;
  let settleRaf: number | undefined;
  const storage = createStorage();

  // short-lived 60fps loop while the slosh spring rings; self-terminates
  // the moment the water sleeps, handing back to the slow ambient ticker
  const startSettleLoop = (): void => {
    if (settleRaf !== undefined) return;
    const frame = (now: number): void => {
      settleRaf = undefined;
      if (!view || document.visibilityState !== "visible") return;
      view.tick(now);
      markDirty();
      if (view.isSloshing()) {
        settleRaf = requestAnimationFrame(frame);
      }
    };
    settleRaf = requestAnimationFrame(frame);
  };

  const stopSettleLoop = (): void => {
    if (settleRaf !== undefined) {
      cancelAnimationFrame(settleRaf);
      settleRaf = undefined;
    }
  };

  // ambient + autosave timers exist ONLY while playing AND visible —
  // a hidden window must cost zero timer wakeups (idle-CPU contract).
  // NOTE: the OS reduced-motion flag is deliberately ignored — it silently
  // froze the requested water motion on real machines. If needed later,
  // motion belongs behind an IN-GAME setting, never an invisible OS flag.
  const startTickers = (): void => {
    clearInterval(ambientInterval);
    ambientInterval = setInterval(() => {
      if (!view) return;
      view.tick(performance.now());
      markDirty();
    }, AMBIENT_STEP_MS);
    clearInterval(autosaveInterval);
    autosaveInterval = setInterval(() => void persist(), AUTOSAVE_MS);
  };

  const stopTickers = (): void => {
    clearInterval(ambientInterval);
    clearInterval(autosaveInterval);
    ambientInterval = undefined;
    autosaveInterval = undefined;
  };

  const onVisibilityTickers = (): void => {
    if (document.visibilityState === "hidden") {
      stopTickers();
      stopSettleLoop();
    } else if (view) {
      startTickers();
    }
  };

  const persist = (): Promise<boolean> => {
    const currentSim = loop?.current() ?? sim();
    if (!activeTank || !currentSim) return Promise.resolve(false);
    const data = buildSave(
      activeTank,
      currentSim,
      discoveries(),
      Date.now(),
      speciesDiscovered(),
    );
    return storage.write(JSON.stringify(data));
  };

  const handleSimUpdate = (
    simState: SimState,
    events: readonly SimEvent[],
  ): void => {
    setSim(simState);
    const milestones = recordEvents(events);
    const population = activeTank ? populationFor(activeTank, simState) : [];
    const arrivals = recordSightings(population, simState.simTimeMs);
    announceDiscoveries([...milestones, ...arrivals]);
    view?.update(simState, population);
    markDirty();
    if (milestones.length > 0) playChime(true);
    else if (arrivals.length > 0) playChime(false);
    // milestones and first sightings are precious — save immediately
    if (milestones.length > 0 || arrivals.length > 0) void persist();
  };

  const beginPlaying = (newTank: TankState, simState: SimState): void => {
    const app = getApp();
    view?.destroy();
    view = buildTankView(app.stage, newTank, app.screen.width, app.screen.height);
    const population = populationFor(newTank, simState);
    recordSightings(population, simState.simTimeMs); // journal only, no toasts
    view.update(simState, population);
    activeTank = newTank;
    setTank(newTank);
    setSim(simState);
    setScreen("playing");
    markDirty();

    loop?.stop();
    loop = createGameLoop(newTank.env, {
      onUpdate: handleSimUpdate,
      onHidden: () => void persist(),
    });
    loop.start(simState);
    // time controls reset per world
    setTimePaused(false);
    setTimeSpeed(1);

    startTickers();

    // dragging the window sloshes the water — cozy juice
    motionTracker?.dispose();
    motionTracker = createWindowMotionTracker({
      onImpulse: (ax, ay) => {
        if (!view || document.visibilityState !== "visible") return;
        view.applyWindowImpulse(ax, ay);
        startSettleLoop();
      },
    });

    startAmbient({
      waterAmount: newTank.env.waterFraction,
      landAmount: newTank.landPercent / 100,
    });
  };

  const startNewGame = (seed: number, land: number, simHours = 0): void => {
    const newTank = generateTank(seed, land);
    let simState = createInitialSimState(seed);
    // dev fast-forward in chunks (catch-up is clamped to 24h by design)
    let remainingMs = simHours * HOUR_MS;
    setDiscoveries([]);
    setSpeciesDiscovered(new Map());
    while (remainingMs > 0) {
      const chunk = Math.min(remainingMs, 12 * HOUR_MS);
      const result = advanceSim(simState, chunk, newTank.env);
      simState = result.state;
      recordEvents(result.events); // journal only — no toast flood
      remainingMs -= chunk;
    }
    beginPlaying(newTank, simState);
    void persist();
  };

  const continueGame = (save: SaveData): void => {
    const newTank = generateTank(save.seed, save.landPercent);
    let simState = restoreSim(save);
    // a patch may have changed the world recipe or growth balance —
    // never block loading, but be honest about it
    if (save.genVersion !== newTank.genVersion) {
      pushToast(
        "World recipe updated",
        "Terrain may look a little different after the update.",
      );
    } else if (save.tunablesHash !== hashTunables(DEFAULT_TUNABLES)) {
      pushToast(
        "Growth rebalanced",
        "Life may grow at a slightly different pace after the update.",
      );
    }
    setDiscoveries(
      save.discoveries.map((d) => ({
        phase: d.phase,
        atSimTimeMs: d.atSimTimeMs,
      })),
    );
    setSpeciesDiscovered(
      new Map(save.speciesDiscovered.map((s) => [s.id, s.atSimTimeMs])),
    );

    // offline catch-up: the world kept living while the app was closed
    // (growth is clamped to a gentle day — report what actually happened)
    const awayMs = Date.now() - save.savedAtUnixMs;
    if (awayMs > 30_000) {
      const result = advanceSim(simState, awayMs, newTank.env);
      simState = result.state;
      const milestones = recordEvents(result.events);
      announceDiscoveries(milestones);
      const grownMs = Math.min(awayMs, DEFAULT_TUNABLES.maxCatchupMs);
      const grownHours = Math.floor(grownMs / HOUR_MS);
      if (grownHours >= 1) {
        pushToast(
          "Welcome back",
          `Your world kept growing for ${grownHours}h while you were away.`,
        );
      }
    }
    beginPlaying(newTank, simState);
    void persist();
  };

  const backToMenu = async (): Promise<void> => {
    const saved = persist(); // begin the write, then tear down
    stopAmbient();
    loop?.stop();
    loop = undefined;
    clearInterval(ambientInterval);
    clearInterval(autosaveInterval);
    motionTracker?.dispose();
    motionTracker = undefined;
    stopSettleLoop();
    view?.destroy();
    view = undefined;
    activeTank = null;
    resetGameState();
    setScreen("menu");
    markDirty();
    await saved; // the Continue card must reflect THIS world
    await loadSavedGame();
  };

  const loadSavedGame = async (): Promise<void> => {
    const primary = await storage.read();
    let save = primary !== null ? parseSave(primary) : null;
    if (!save) {
      const backup = await storage.readBackup();
      save = backup !== null ? parseSave(backup) : null;
      if (save) {
        pushToast(
          "Save restored",
          "The main save was unreadable — recovered from backup.",
        );
      }
    }
    setSavedGame(save);
  };

  const [pixiReady, setPixiReady] = createSignal(false);

  onMount(() => {
    if (!host) return;
    loadMutePreference();
    bindAudioVisibility();
    document.addEventListener("visibilitychange", onVisibilityTickers);
    onCleanup(() =>
      document.removeEventListener("visibilitychange", onVisibilityTickers),
    );
    void (async () => {
      await createPixiApp(host!);
      setPixiReady(true);
      await loadSavedGame();
      const dev = readDevParams();
      if (dev) {
        startNewGame(dev.seed, dev.land, dev.simHours);
      }
    })();

    const onBeforeUnload = (): void => void persist();
    window.addEventListener("beforeunload", onBeforeUnload);
    onCleanup(() => window.removeEventListener("beforeunload", onBeforeUnload));

    // dev-only cheat: G fast-forwards growth 6h for visual testing
    if (import.meta.env.DEV) {
      const onKey = (e: KeyboardEvent): void => {
        if (e.key.toLowerCase() !== "g" || !loop) return;
        loop.advanceBy(6 * HOUR_MS);
        void persist();
        pushToast("Time skip (dev)", "+6 hours of growth");
      };
      window.addEventListener("keydown", onKey);
      onCleanup(() => window.removeEventListener("keydown", onKey));
    }

    // rebuild the scene when the window is resized (debounced)
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const currentSim = loop?.current() ?? sim();
        if (!view || !activeTank || !currentSim) return;
        const app = getApp();
        view.destroy();
        view = buildTankView(
          app.stage,
          activeTank,
          app.screen.width,
          app.screen.height,
        );
        view.update(currentSim, populationFor(activeTank, currentSim));
        markDirty();
      }, 250);
    });
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  });

  onCleanup(() => {
    loop?.stop();
    clearInterval(ambientInterval);
    clearInterval(autosaveInterval);
    motionTracker?.dispose();
    stopSettleLoop();
    view?.destroy();
    destroyPixiApp();
  });

  return (
    <div class="app-shell">
      <div class="canvas-host" ref={host} />
      <div class="ui-overlay" id="ui">
        <Show when={screen() === "menu"}>
          <NewTankScreen
            ready={pixiReady()}
            onStart={(seed, land) => startNewGame(seed, land)}
            savedGame={savedGame()}
            onContinue={() => {
              const save = savedGame();
              if (save) continueGame(save);
            }}
          />
        </Show>
        <Show when={screen() === "playing" && sim() && tank()}>
          <Hud
            onNewTank={() => void backToMenu()}
            onPauseChange={(paused) => loop?.setPaused(paused)}
            onSpeedChange={(speed) => loop?.setSpeed(speed)}
          />
          <Almanac />
        </Show>
        <Toasts />
      </div>
    </div>
  );
}
