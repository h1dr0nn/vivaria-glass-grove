import { Container, FillGradient, Graphics } from "pixi.js";
import { SCENE } from "../palette";
import type { TankLayout } from "../layout";

/** The warm room behind the glass, plus a soft shelf shadow under the tank. */
export function buildBackdrop(
  width: number,
  height: number,
  layout: TankLayout,
): Container {
  const container = new Container();

  const room = new Graphics();
  const gradient = new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: SCENE.roomTop },
      { offset: 0.55, color: SCENE.roomMid },
      { offset: 1, color: SCENE.roomBottom },
    ],
    textureSpace: "local",
  });
  room.rect(0, 0, width, height).fill(gradient);
  container.addChild(room);

  // soft tinted shadow pooling under the tank - three stacked translucent
  // ellipses so the edge feathers instead of stepping at the corners
  const shadow = new Graphics();
  const cx = layout.originX + layout.tankWidthPx / 2;
  const cy = layout.originY + layout.scale * 3;
  for (const [spread, alpha] of [
    [1.0, 0.07],
    [0.82, 0.09],
    [0.62, 0.11],
  ] as const) {
    shadow
      .ellipse(cx, cy, layout.tankWidthPx * 0.56 * spread, layout.scale * 3.4 * spread)
      .fill({ color: SCENE.glassShadow, alpha });
  }
  container.addChild(shadow);

  return container;
}
