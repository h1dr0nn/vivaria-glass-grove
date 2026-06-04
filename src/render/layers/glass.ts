import { Container, FillGradient, Graphics } from "pixi.js";
import { SCENE } from "../palette";
import type { TankLayout } from "../layout";

/** Front glass pane: edge stroke, corner light, soft inner shadow. */
export function buildGlass(layout: TankLayout): Container {
  const container = new Container();
  const x = layout.originX;
  const y = layout.originY - layout.tankHeightPx;
  const w = layout.tankWidthPx;
  const h = layout.tankHeightPx;
  const radius = Math.max(6, layout.scale * 1.6);

  // subtle vertical sheen across the pane
  const sheen = new Graphics();
  const sheenGradient = new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    colorStops: [
      { offset: 0, color: 0xffffff },
      { offset: 0.12, color: 0xffffff },
      { offset: 0.2, color: 0xffffff },
      { offset: 1, color: 0xffffff },
    ],
    textureSpace: "local",
  });
  sheen.roundRect(x, y, w, h, radius).fill(sheenGradient);
  sheen.alpha = 0.05;
  container.addChild(sheen);

  const frame = new Graphics();
  // inner shadow hugging the glass walls (tinted, never black)
  frame
    .roundRect(x + 1.5, y + 1.5, w - 3, h - 3, radius)
    .stroke({ color: SCENE.glassShadow, alpha: 0.18, width: 4 });
  // crisp glass edge
  frame
    .roundRect(x, y, w, h, radius)
    .stroke({ color: SCENE.glassEdge, alpha: 0.9, width: 2 });
  // top rim highlight
  frame
    .moveTo(x + radius, y + 1)
    .lineTo(x + w - radius, y + 1)
    .stroke({ color: 0xffffff, alpha: 0.55, width: 1.5 });
  container.addChild(frame);

  return container;
}
