import { Show, onCleanup, onMount } from "solid-js";
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
import { createStorage } from "./persistence/storage";
import { buildSave, parseSave, restoreSim } from "./persistence/saves";
import type { SaveData } from "./persistence/saveSchema";
import NewTankScreen from "./ui/NewTankScreen";
import Hud from "./ui/Hud";
import Almanac from "./ui/Almanac";
import Toasts from "./ui/Toasts";
import {
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
  sim,
  speciesDiscovered,
  tank,
} from "./ui/store";

const HOUR_MS = 3_600_000;
const AMBIENT_STEP_MS = 80;
const AUTOSAVE_MS = 60_000;

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
  let loop: GameLoop | undefined;
  let ambientInterval: ReturnType<typeof setInterval> | undefined;
  let autosaveInterval: ReturnType<typeof setInterval> | undefined;
  let activeTank: TankState | null = null;
  const storage = createStorage();

  const persist = (): void => {
    const currentSim = loop?.current() ?? sim();
    if (!activeTank || !currentSim) return;
    const data = buildSave(
      activeTank,
      currentSim,
      discoveries(),
      Date.now(),
      speciesDiscovered(),
    );
    void storage.write(JSON.stringify(data));
  };

  const handleSimUpdate = (
    simState: SimState,
    events: readonly SimEvent[],
  ): void => {
    setSim(simState);
    recordEvents(events);
    const population = activeTank ? populationFor(activeTank, simState) : [];
    const newSightings = recordSightings(population, simState.simTimeMs);
    view?.update(simState, population);
    markDirty();
    // milestones and first sightings are precious — save immediately
    if (events.length > 0 || newSightings) persist();
  };

  const beginPlaying = (newTank: TankState, simState: SimState): void => {
    const app = getApp();
    view?.destroy();
    view = buildTankView(app.stage, newTank, app.screen.width, app.screen.height);
    const population = populationFor(newTank, simState);
    recordSightings(population, simState.simTimeMs, false);
    view.update(simState, population);
    activeTank = newTank;
    setTank(newTank);
    setSim(simState);
    setScreen("playing");
    markDirty();

    loop?.stop();
    loop = createGameLoop(newTank.env, {
      onUpdate: handleSimUpdate,
      onHidden: persist,
    });
    loop.start(simState);

    clearInterval(ambientInterval);
    ambientInterval = setInterval(() => {
      if (document.visibilityState !== "visible" || !view) return;
      view.tick(performance.now());
      markDirty();
    }, AMBIENT_STEP_MS);

    clearInterval(autosaveInterval);
    autosaveInterval = setInterval(persist, AUTOSAVE_MS);
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
      recordEvents(result.events);
      remainingMs -= chunk;
    }
    beginPlaying(newTank, simState);
    persist();
  };

  const continueGame = (save: SaveData): void => {
    const newTank = generateTank(save.seed, save.landPercent);
    let simState = restoreSim(save);
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
    const awayMs = Date.now() - save.savedAtUnixMs;
    if (awayMs > 30_000) {
      const result = advanceSim(simState, awayMs, newTank.env);
      simState = result.state;
      recordEvents(result.events);
      const awayHours = Math.floor(awayMs / HOUR_MS);
      if (awayHours >= 1) {
        pushToast(
          "Welcome back",
          `Your world kept growing for ${awayHours}h while you were away.`,
        );
      }
    }
    beginPlaying(newTank, simState);
    persist();
  };

  const backToMenu = (): void => {
    persist();
    loop?.stop();
    loop = undefined;
    clearInterval(ambientInterval);
    clearInterval(autosaveInterval);
    view?.destroy();
    view = undefined;
    activeTank = null;
    resetGameState();
    void loadSavedGame(); // refresh the Continue card
    setScreen("menu");
    markDirty();
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

  onMount(() => {
    if (!host) return;
    void (async () => {
      await createPixiApp(host!);
      await loadSavedGame();
      const dev = readDevParams();
      if (dev) {
        startNewGame(dev.seed, dev.land, dev.simHours);
      }
    })();

    const onBeforeUnload = (): void => persist();
    window.addEventListener("beforeunload", onBeforeUnload);
    onCleanup(() => window.removeEventListener("beforeunload", onBeforeUnload));
  });

  onCleanup(() => {
    loop?.stop();
    clearInterval(ambientInterval);
    clearInterval(autosaveInterval);
    view?.destroy();
    destroyPixiApp();
  });

  return (
    <div class="app-shell">
      <div class="canvas-host" ref={host} />
      <div class="ui-overlay" id="ui">
        <Show when={screen() === "menu"}>
          <NewTankScreen
            onStart={(seed, land) => startNewGame(seed, land)}
            savedGame={savedGame()}
            onContinue={() => {
              const save = savedGame();
              if (save) continueGame(save);
            }}
          />
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
