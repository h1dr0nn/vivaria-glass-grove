import { Show, createMemo, createSignal } from "solid-js";
import { isMuted, setMuted } from "../audio/engine";
import { IconBook, IconSprout, IconVolume, IconVolumeMuted } from "./icons";
import {
  PHASE_INFO,
  formatSimAge,
  nextMilestone,
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
  const [muted, setMutedSignal] = createSignal(isMuted());
  const upNext = createMemo(() => {
    const current = sim();
    return current ? nextMilestone(current) : null;
  });

  const toggleMute = (): void => {
    const next = !muted();
    setMuted(next);
    setMutedSignal(next);
  };

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
          <Show when={upNext()}>
            {(milestone) => (
              <>
                <span class="hud-divider" aria-hidden="true" />
                <span class="hud-next" title="What the world is reaching toward">
                  next: {milestone().label}{" "}
                  {Math.min(99, Math.floor(milestone().progress * 100))}%
                </span>
              </>
            )}
          </Show>
        </div>
        <div class="hud-actions">
          <button
            type="button"
            class="hud-button hud-button-icon"
            onClick={toggleMute}
            title={muted() ? "Unmute" : "Mute"}
            aria-label={muted() ? "Unmute sounds" : "Mute sounds"}
          >
            {muted() ? <IconVolumeMuted /> : <IconVolume />}
          </button>
          <button
            type="button"
            class="hud-button"
            classList={{ active: almanacOpen() }}
            onClick={() => setAlmanacOpen(!almanacOpen())}
          >
            <IconBook /> Almanac
          </button>
          <button type="button" class="hud-button" onClick={props.onNewTank}>
            <IconSprout /> New tank
          </button>
        </div>
      </div>
    </Show>
  );
}
