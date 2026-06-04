import { For, createMemo } from "solid-js";
import { toasts } from "./store";

const MAX_VISIBLE_TOASTS = 3;

export default function Toasts() {
  const visible = createMemo(() => toasts().slice(-MAX_VISIBLE_TOASTS));
  return (
    <div class="toast-stack" aria-live="polite">
      <For each={visible()}>
        {(toast) => (
          <div class="toast">
            <div class="toast-title">{toast.title}</div>
            <div class="toast-detail">{toast.detail}</div>
          </div>
        )}
      </For>
    </div>
  );
}
