import { onCleanup, onMount } from "solid-js";
import "./ui/tokens.css";
import "./ui/app.css";
import { createPixiApp, destroyPixiApp, markDirty } from "./render/pixiApp";
import { buildPlaceholderScene } from "./render/placeholderScene";

export default function App() {
  let host: HTMLDivElement | undefined;

  onMount(() => {
    if (!host) return;
    void (async () => {
      const app = await createPixiApp(host);
      buildPlaceholderScene(app.stage, app.screen.width, app.screen.height);
      markDirty();
    })();
  });

  onCleanup(() => destroyPixiApp());

  return (
    <div class="app-shell">
      <div class="canvas-host" ref={host} />
      <div class="ui-overlay" id="ui" />
    </div>
  );
}
