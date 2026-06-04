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

  // soft tinted shadow pooling under the tank — grounds it in the room
  const shadow = new Graphics();
  const cx = layout.originX + layout.tankWidthPx / 2;
  const cy = layout.originY + layout.scale * 2.5;
  shadow
    .ellipse(cx, cy, layout.tankWidthPx * 0.56, layout.scale * 4)
    .fill({ color: SCENE.glassShadow, alpha: 0.28 });
  container.addChild(shadow);

  return container;
}
