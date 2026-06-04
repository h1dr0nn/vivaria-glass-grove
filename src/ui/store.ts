import { createSignal } from "solid-js";
import type { SimEvent, SimState, SuccessionPhase } from "../sim/types";
import type { TankState } from "../sim/tankgen";
import type { SaveData } from "../persistence/saveSchema";
import { DEFAULT_TUNABLES } from "../sim/tunables";

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

export interface Announcement {
  readonly title: string;
  readonly detail: string;
}

/** Record first sightings of species. Returns the new arrivals (no toasts). */
export function recordSightings(
  population: ReadonlyArray<{
    readonly def: { readonly id: string; readonly name: string; readonly blurb: string };
  }>,
  simTimeMs: number,
): Announcement[] {
  const known = speciesDiscovered();
  const fresh = population.filter((entry) => !known.has(entry.def.id));
  if (fresh.length === 0) return [];
  const next = new Map(known);
  for (const entry of fresh) {
    next.set(entry.def.id, simTimeMs);
  }
  setSpeciesDiscovered(next);
  return fresh.map((entry) => ({
    title: `${entry.def.name} arrived!`,
    detail: entry.def.blurb,
  }));
}

/** Fold sim events into the journal. Returns the new milestones (no toasts). */
export function recordEvents(events: readonly SimEvent[]): Announcement[] {
  const fresh: Announcement[] = [];
  for (const event of events) {
    if (event.type !== "phase-advanced") continue;
    let added = false;
    setDiscoveries((current) => {
      if (current.some((d) => d.phase === event.phase)) return current;
      added = true;
      return [...current, { phase: event.phase, atSimTimeMs: event.atSimTimeMs }];
    });
    if (added) {
      const info = PHASE_INFO[event.phase];
      fresh.push({ title: info.name, detail: info.detail });
    }
  }
  return fresh;
}

const TOAST_BATCH_LIMIT = 3;

/**
 * Announce discoveries gently: a few get their own toasts, a flood becomes
 * one calm summary (long offline catch-up must not bury the screen).
 */
export function announceDiscoveries(items: readonly Announcement[]): void {
  if (items.length === 0) return;
  if (items.length <= TOAST_BATCH_LIMIT) {
    for (const item of items) pushToast(item.title, item.detail);
    return;
  }
  pushToast(
    `${items.length} new things appeared`,
    "Your world has been busy — open the journal to meet them.",
  );
}

export function resetGameState(): void {
  setSim(null);
  setTank(null);
  setDiscoveries([]);
  setSpeciesDiscovered(new Map());
  setAlmanacOpen(false);
}

/** What the world is reaching toward — makes the next clock legible. */
export function nextMilestone(
  state: SimState,
): { label: string; progress: number } | null {
  const t = DEFAULT_TUNABLES;
  switch (state.phase) {
    case "sterile":
      return {
        label: PHASE_INFO.microbes.name,
        progress: state.scalars.microbes / t.microbes.establishThreshold,
      };
    case "microbes":
      return {
        label: PHASE_INFO.algae.name,
        progress: state.scalars.algae / t.algae.establishThreshold,
      };
    case "algae":
      return {
        label: PHASE_INFO.plants.name,
        progress: state.scalars.plants / t.plants.establishThreshold,
      };
    case "plants":
      return {
        label: PHASE_INFO.fauna.name,
        progress: state.scalars.plants / t.faunaTrigger,
      };
    default:
      return null;
  }
}

/** "Day 3 · 04:12:36" from sim time — a clock the player can watch run. */
export function formatSimAge(simTimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(simTimeMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86_400);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days <= 0 ? clock : `Day ${days + 1} · ${clock}`;
}

/** Time controls — session-level, wired to the game loop by App. */
export const SPEED_STEPS = [1, 2, 3, 5, 10] as const;

const [timePaused, setTimePaused] = createSignal(false);
const [timeSpeed, setTimeSpeed] = createSignal<number>(SPEED_STEPS[0]);

export { timePaused, setTimePaused, timeSpeed, setTimeSpeed };
