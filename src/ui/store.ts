import { createSignal } from "solid-js";
import type { SimEvent, SimState, SuccessionPhase } from "../sim/types";
import type { TankState } from "../sim/tankgen";

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

export {
  screen,
  setScreen,
  tank,
  setTank,
  sim,
  setSim,
  discoveries,
  toasts,
  almanacOpen,
  setAlmanacOpen,
};

let nextToastId = 0;

export function pushToast(title: string, detail: string): void {
  const id = ++nextToastId;
  setToasts((current) => [...current, { id, title, detail }]);
  setTimeout(() => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, 6000);
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
  setAlmanacOpen(false);
}

/** "Day 3 · 14h" from sim time. */
export function formatSimAge(simTimeMs: number): string {
  const hours = Math.floor(simTimeMs / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days <= 0) return `${Math.max(0, hours)}h`;
  return `Day ${days + 1} · ${hours % 24}h`;
}
