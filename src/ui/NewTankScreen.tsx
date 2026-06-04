import { Show, createMemo, createSignal } from "solid-js";
import TankPreview from "./TankPreview";
import { archetypeOf } from "../sim/tankgen";
import { mix32 } from "../sim/rng";
import type { SaveData } from "../persistence/saveSchema";
import { formatSimAge } from "./store";

interface NewTankScreenProps {
  onStart: (seed: number, land: number) => void;
  savedGame: SaveData | null;
  onContinue: () => void;
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
    blurb: "Half pond, half forest floor — the richest of worlds.",
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

  const seed = createMemo(() => seedFromText(seedText()));
  const archetype = createMemo(() => ARCHETYPE_COPY[archetypeOf(land())]);

  const rollSeed = (): void => {
    setSeedText(String(Math.floor(Math.random() * 0xffffffff)));
  };

  const handleStart = (): void => {
    if (props.savedGame && !confirmingReplace()) {
      setConfirmingReplace(true);
      return;
    }
    props.onStart(seed(), land());
  };

  return (
    <div class="menu-screen">
      <div class="menu-panel">
        <header class="menu-header">
          <h1 class="menu-title">Terarium</h1>
          <p class="menu-subtitle">grow a tiny world from nothing</p>
        </header>

        <Show when={props.savedGame}>
          {(save) => (
            <button
              type="button"
              class="continue-card"
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
            onInput={(e) => setLand(Number.parseInt(e.currentTarget.value, 10))}
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
            placeholder="seed — any words you like"
            aria-label="World seed"
          />
          <button
            type="button"
            class="dice-button"
            onClick={rollSeed}
            title="Random seed"
          >
            ⚄
          </button>
        </div>

        <button
          type="button"
          class="grow-button"
          classList={{ "grow-button-warning": confirmingReplace() }}
          onClick={handleStart}
        >
          {confirmingReplace()
            ? "Replace your current world?"
            : props.savedGame
              ? "Start a new world"
              : "Begin growing"}
        </button>
      </div>
    </div>
  );
}
