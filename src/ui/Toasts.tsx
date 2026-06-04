import { For } from "solid-js";
import { toasts } from "./store";

export default function Toasts() {
  return (
    <div class="toast-stack" aria-live="polite">
      <For each={toasts()}>
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
