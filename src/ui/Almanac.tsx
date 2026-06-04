import { For, Show, createMemo } from "solid-js";
import { PHASE_ORDER, type SuccessionPhase } from "../sim/types";
import { SPECIES, type Habitat } from "../sim/species";
import {
  PHASE_INFO,
  almanacOpen,
  discoveries,
  formatSimAge,
  setAlmanacOpen,
  speciesDiscovered,
} from "./store";

const TRACKED_PHASES = PHASE_ORDER.filter((p) => p !== "sterile");

const HABITAT_HINT: Record<Habitat, string> = {
  water: "Something stirs in open water…",
  floor: "Something forages along the bottom…",
  shore: "Something waits where water meets land…",
  land: "Something rustles in the green…",
  air: "Something may take to the air…",
};

export default function Almanac() {
  const foundPhases = createMemo(() => {
    const map = new Map<SuccessionPhase, number>();
    for (const d of discoveries()) map.set(d.phase, d.atSimTimeMs);
    return map;
  });

  return (
    <Show when={almanacOpen()}>
      <aside class="almanac" aria-label="Field journal">
        <header class="almanac-header">
          <h2>Field journal</h2>
          <button
            type="button"
            class="almanac-close"
            onClick={() => setAlmanacOpen(false)}
            aria-label="Close journal"
          >
            ×
          </button>
        </header>
        <p class="almanac-progress">
          {foundPhases().size} / {TRACKED_PHASES.length} milestones ·{" "}
          {speciesDiscovered().size} / {SPECIES.length} species
        </p>

        <div class="almanac-scroll">
          <h3 class="almanac-section">Milestones</h3>
          <ul class="almanac-list">
            <For each={TRACKED_PHASES}>
              {(phase) => {
                const at = () => foundPhases().get(phase);
                return (
                  <li
                    class="almanac-entry"
                    classList={{ locked: at() === undefined }}
                  >
                    <div class="almanac-entry-name">
                      {at() !== undefined ? PHASE_INFO[phase].name : "— ? —"}
                    </div>
                    <div class="almanac-entry-detail">
                      {at() !== undefined
                        ? PHASE_INFO[phase].detail
                        : "Keep tending. Life will find its way."}
                    </div>
                    <Show when={at() !== undefined}>
                      <div class="almanac-entry-time">
                        witnessed {formatSimAge(at()!)}
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>

          <h3 class="almanac-section">Life</h3>
          <ul class="almanac-list">
            <For each={SPECIES}>
              {(species) => {
                const at = () => speciesDiscovered().get(species.id);
                return (
                  <li
                    class="almanac-entry"
                    classList={{ locked: at() === undefined }}
                  >
                    <div class="almanac-entry-name">
                      {at() !== undefined ? species.name : "— ? —"}
                    </div>
                    <div class="almanac-entry-detail">
                      {at() !== undefined
                        ? species.blurb
                        : HABITAT_HINT[species.habitat]}
                    </div>
                    <Show when={at() !== undefined}>
                      <div class="almanac-entry-time">
                        first seen {formatSimAge(at()!)}
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </div>
      </aside>
    </Show>
  );
}
