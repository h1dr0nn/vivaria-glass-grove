import { Show, createMemo, createSignal } from "solid-js";
import TankPreview from "./TankPreview";
import { archetypeOf } from "../sim/tankgen";
import { mix32 } from "../sim/rng";
import type { SaveData } from "../persistence/saveSchema";
import { IconDice } from "./icons";
import { formatSimAge } from "./store";

interface NewTankScreenProps {
  onStart: (seed: number, land: number) => void;
  savedGame: SaveData | null;
  onContinue: () => void;
  /** renderer initialized - starting before this would crash */
  ready: boolean;
}

const ARCHETYPE_COPY: Record<string, { name: string; blurb: string }> = {
  "open-water": {
    name: "Open water",
    blurb: "A clear pool, waiting for its first green breath.",
  },
  riverbank: {
    name: "Riverbank",
    blurb: "Gentle water meeting a soft rise of earth.",
  },
  paludarium: {
    name: "Paludarium",
    blurb: "Half pond, half forest floor - the richest of worlds.",
  },
  hillside: {
    name: "Hillside",
    blurb: "High ground and a small spring-fed pool.",
  },
  dryland: {
    name: "Dryland",
    blurb: "Moss and mist will have to carry life here.",
  },
};

/** Hash any seed text into a uint32 (numbers pass through). */
function seedFromText(text: string): number {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) >>> 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    hash = mix32(hash ^ trimmed.charCodeAt(i));
  }
  return hash >>> 0;
}

export default function NewTankScreen(props: NewTankScreenProps) {
  const [land, setLand] = createSignal(35);
  const [seedText, setSeedText] = createSignal("first jar");
  const [confirmingReplace, setConfirmingReplace] = createSignal(false);
  // with an existing world the creation panel stays tucked away -
  // a stray click must never threaten the player's save
  const [creating, setCreating] = createSignal(false);

  const seed = createMemo(() => seedFromText(seedText()));
  const archetype = createMemo(() => ARCHETYPE_COPY[archetypeOf(land())]);
  const showCreation = createMemo(() => !props.savedGame || creating());

  const rollSeed = (): void => {
    setSeedText(String(Math.floor(Math.random() * 0xffffffff)));
  };

  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  const handleStart = (): void => {
    if (!props.ready) return;
    if (props.savedGame && !confirmingReplace()) {
      setConfirmingReplace(true);
      // a mis-click shouldn't leave a destructive button armed
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => setConfirmingReplace(false), 4000);
      return;
    }
    clearTimeout(confirmTimer);
    props.onStart(seed(), land());
  };

  return (
    <div class="menu-screen">
      <div class="menu-panel">
        <header class="menu-header">
          <h1 class="menu-title">Vivaria</h1>
          <p class="menu-subtitle">Glass Grove · grow a tiny world from nothing</p>
        </header>

        <Show when={props.savedGame}>
          {(save) => (
            <button
              type="button"
              class="continue-card"
              disabled={!props.ready}
              onClick={() => props.onContinue()}
            >
              <span class="continue-label">Continue your world</span>
              <span class="continue-detail">
                {ARCHETYPE_COPY[archetypeOf(save().landPercent)].name} ·{" "}
                {formatSimAge(save().sim.simTimeMs)} · {save().landPercent}%
                land
              </span>
            </button>
          )}
        </Show>

        <Show when={props.savedGame && !creating()}>
          <button
            type="button"
            class="menu-secondary"
            disabled={!props.ready}
            onClick={() => setCreating(true)}
          >
            Start a new world…
          </button>
        </Show>

        <Show when={showCreation()}>
          <TankPreview seed={seed()} land={land()} />

          <div class="archetype-line">
            <span class="archetype-name">{archetype().name}</span>
            <span class="archetype-blurb">{archetype().blurb}</span>
          </div>

          <label class="slider-row" for="land-slider">
            <span class="slider-label water-label">water</span>
            <input
              id="land-slider"
              type="range"
              min="0"
              max="100"
              value={land()}
              onInput={(e) =>
                setLand(Number.parseInt(e.currentTarget.value, 10))
              }
            />
            <span class="slider-label land-label">land</span>
          </label>
          <div class="slider-value">
            {100 - land()}% water · {land()}% land
          </div>

          <div class="seed-row">
            <input
              type="text"
              class="seed-input"
              value={seedText()}
              onInput={(e) => setSeedText(e.currentTarget.value)}
              placeholder="seed - any words you like"
              aria-label="World seed"
            />
            <button
              type="button"
              class="dice-button"
              onClick={rollSeed}
              title="Random seed"
              aria-label="Random seed"
            >
              <IconDice size={18} />
            </button>
          </div>

          <button
            type="button"
            class="grow-button"
            classList={{ "grow-button-warning": confirmingReplace() }}
            disabled={!props.ready}
            onClick={handleStart}
          >
            {confirmingReplace()
              ? "Replace your current world?"
              : props.savedGame
                ? "Start a new world"
                : "Begin growing"}
          </button>

          <Show when={props.savedGame}>
            <button
              type="button"
              class="menu-back"
              onClick={() => {
                setCreating(false);
                setConfirmingReplace(false);
                clearTimeout(confirmTimer);
              }}
            >
              ← keep my world
            </button>
          </Show>
        </Show>
      </div>
    </div>
  );
}
