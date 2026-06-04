import { createSignal } from "solid-js";
import type { SimEvent, SimState, SuccessionPhase } from "../sim/types";
import type { TankState } from "../sim/tankgen";
import type { SaveData } from "../persistence/saveSchema";

/** Central UI state — Solid signals, near-zero idle work. */

export type Screen = "menu" | "playing";

export interface Discovery {
  readonly phase: SuccessionPhase;
  readonly atSimTimeMs: number;
}

export interface Toast {
  readonly id: number;
  readonly title: string;
  readonly detail: string;
}

export const PHASE_INFO: Record<
  SuccessionPhase,
  { name: string; detail: string }
> = {
  sterile: { name: "Sterile", detail: "A quiet glass world, waiting." },
  microbes: {
    name: "Microbial bloom",
    detail: "Invisible life stirs — the water shimmers faintly.",
  },
  algae: {
    name: "Algae & biofilm",
    detail: "Green films spread over wet stone and glass.",
  },
  plants: {
    name: "First sprouts",
    detail: "Roots take hold. Leaves reach for the light.",
  },
  fauna: {
    name: "First grazers",
    detail: "Something small is moving in there.",
  },
};

const [screen, setScreen] = createSignal<Screen>("menu");
const [tank, setTank] = createSignal<TankState | null>(null);
const [sim, setSim] = createSignal<SimState | null>(null);
const [discoveries, setDiscoveries] = createSignal<readonly Discovery[]>([]);
const [toasts, setToasts] = createSignal<readonly Toast[]>([]);
const [almanacOpen, setAlmanacOpen] = createSignal(false);
/** the save found on disk at startup (drives the Continue option) */
const [savedGame, setSavedGame] = createSignal<SaveData | null>(null);
/** species id → simTimeMs of first sighting */
const [speciesDiscovered, setSpeciesDiscovered] = createSignal<
  ReadonlyMap<string, number>
>(new Map());

export {
  screen,
  setScreen,
  tank,
  setTank,
  sim,
  setSim,
  discoveries,
  setDiscoveries,
  toasts,
  almanacOpen,
  setAlmanacOpen,
  savedGame,
  setSavedGame,
  speciesDiscovered,
  setSpeciesDiscovered,
};

let nextToastId = 0;

export function pushToast(title: string, detail: string): void {
  const id = ++nextToastId;
  setToasts((current) => [...current, { id, title, detail }]);
  setTimeout(() => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, 6000);
}

/** Record first sightings of species — the "something arrived!" moments. */
export function recordSightings(
  population: ReadonlyArray<{
    readonly def: { readonly id: string; readonly name: string; readonly blurb: string };
  }>,
  simTimeMs: number,
  announce = true,
): boolean {
  const known = speciesDiscovered();
  const fresh = population.filter((entry) => !known.has(entry.def.id));
  if (fresh.length === 0) return false;
  const next = new Map(known);
  for (const entry of fresh) {
    next.set(entry.def.id, simTimeMs);
    if (announce) pushToast(`${entry.def.name} arrived!`, entry.def.blurb);
  }
  setSpeciesDiscovered(next);
  return true;
}

/** Fold sim events into discoveries + toasts. */
export function recordEvents(events: readonly SimEvent[]): void {
  for (const event of events) {
    if (event.type !== "phase-advanced") continue;
    setDiscoveries((current) => {
      if (current.some((d) => d.phase === event.phase)) return current;
      return [...current, { phase: event.phase, atSimTimeMs: event.atSimTimeMs }];
    });
    const info = PHASE_INFO[event.phase];
    pushToast(info.name, info.detail);
  }
}

export function resetGameState(): void {
  setSim(null);
  setTank(null);
  setDiscoveries([]);
  setSpeciesDiscovered(new Map());
  setAlmanacOpen(false);
}

/** "Day 3 · 14h" from sim time. */
export function formatSimAge(simTimeMs: number): string {
  const hours = Math.floor(simTimeMs / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days <= 0) return `${Math.max(0, hours)}h`;
  return `Day ${days + 1} · ${hours % 24}h`;
}
