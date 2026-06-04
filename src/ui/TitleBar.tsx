import { Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import {
  IconMinus,
  IconRestore,
  IconSprout,
  IconSquare,
  IconX,
} from "./icons";

type ResizeDir =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Custom window decoration. The native title bar is off (decorations: false in
 * tauri.conf.json); this draws a slim bar themed a touch darker than the room
 * behind the glass, wires min/maximize/close, and lays invisible grips around
 * the borderless window so it stays resizable. Every Tauri call is guarded for
 * browser dev, where there is no OS window to control.
 */
export default function TitleBar() {
  const tauri = isTauri();
  const [maximized, setMaximized] = createSignal(false);
  let win: TauriWindow | null = null;

  onMount(() => {
    if (!tauri) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        win = getCurrentWindow();
        setMaximized(await win.isMaximized());
        const un = await win.onResized(() => {
          void win?.isMaximized().then((m) => setMaximized(m));
        });
        if (disposed) un();
        else unlisten = un;
      } catch (error: unknown) {
        console.error("titlebar window controls unavailable", error);
      }
    })();
    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
  });

  const minimize = (): void => void win?.minimize();
  const toggleMaximize = (): void => void win?.toggleMaximize();
  const close = (): void => void win?.close();
  const startResize =
    (direction: ResizeDir) =>
    (event: MouseEvent): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      void win?.startResizeDragging(direction);
    };

  return (
    <>
      <header class="titlebar" data-tauri-drag-region>
        <div class="titlebar-brand">
          <IconSprout size={15} />
          <span class="titlebar-name">Vivaria</span>
          <span class="titlebar-sub">Glass Grove</span>
        </div>
        <Show when={tauri}>
          <div class="titlebar-controls">
            <button
              type="button"
              class="titlebar-btn"
              aria-label="Minimize"
              onClick={minimize}
            >
              <IconMinus size={15} />
            </button>
            <button
              type="button"
              class="titlebar-btn"
              aria-label={maximized() ? "Restore" : "Maximize"}
              onClick={toggleMaximize}
            >
              <Show when={maximized()} fallback={<IconSquare size={12} />}>
                <IconRestore size={13} />
              </Show>
            </button>
            <button
              type="button"
              class="titlebar-btn titlebar-close"
              aria-label="Close"
              onClick={close}
            >
              <IconX size={15} />
            </button>
          </div>
        </Show>
      </header>

      <Show when={tauri && !maximized()}>
        <div class="resize-grips" aria-hidden="true">
          <div class="resize-grip rg-n" onMouseDown={startResize("North")} />
          <div class="resize-grip rg-s" onMouseDown={startResize("South")} />
          <div class="resize-grip rg-w" onMouseDown={startResize("West")} />
          <div class="resize-grip rg-e" onMouseDown={startResize("East")} />
          <div
            class="resize-grip rg-nw"
            onMouseDown={startResize("NorthWest")}
          />
          <div
            class="resize-grip rg-ne"
            onMouseDown={startResize("NorthEast")}
          />
          <div
            class="resize-grip rg-sw"
            onMouseDown={startResize("SouthWest")}
          />
          <div
            class="resize-grip rg-se"
            onMouseDown={startResize("SouthEast")}
          />
        </div>
      </Show>
    </>
  );
}
