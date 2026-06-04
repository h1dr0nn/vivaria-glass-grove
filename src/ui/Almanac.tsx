import { For, Show, createMemo } from "solid-js";
import { PHASE_ORDER, type SuccessionPhase } from "../sim/types";
import {
  PHASE_INFO,
  almanacOpen,
  discoveries,
  formatSimAge,
  setAlmanacOpen,
} from "./store";

const TRACKED_PHASES = PHASE_ORDER.filter((p) => p !== "sterile");

export default function Almanac() {
  const found = createMemo(() => {
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
          {found().size} / {TRACKED_PHASES.length} milestones witnessed
        </p>
        <ul class="almanac-list">
          <For each={TRACKED_PHASES}>
            {(phase) => {
              const at = () => found().get(phase);
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
      </aside>
    </Show>
  );
}
