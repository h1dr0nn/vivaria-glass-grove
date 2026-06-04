import { Show } from "solid-js";
import {
  PHASE_INFO,
  formatSimAge,
  setAlmanacOpen,
  almanacOpen,
  sim,
  tank,
} from "./store";

interface HudProps {
  onNewTank: () => void;
}

const ARCHETYPE_LABEL: Record<string, string> = {
  "open-water": "Open water",
  riverbank: "Riverbank",
  paludarium: "Paludarium",
  hillside: "Hillside",
  dryland: "Dryland",
};

export default function Hud(props: HudProps) {
  return (
    <Show when={sim() && tank()}>
      <div class="hud-top">
        <div class="hud-card hud-status">
          <span class="hud-archetype">
            {ARCHETYPE_LABEL[tank()!.archetype]}
          </span>
          <span class="hud-divider" aria-hidden="true" />
          <span class="hud-phase">{PHASE_INFO[sim()!.phase].name}</span>
          <span class="hud-divider" aria-hidden="true" />
          <span class="hud-age">{formatSimAge(sim()!.simTimeMs)}</span>
        </div>
        <div class="hud-actions">
          <button
            type="button"
            class="hud-button"
            classList={{ active: almanacOpen() }}
            onClick={() => setAlmanacOpen(!almanacOpen())}
          >
            Almanac
          </button>
          <button type="button" class="hud-button" onClick={props.onNewTank}>
            New tank
          </button>
        </div>
      </div>
    </Show>
  );
}
