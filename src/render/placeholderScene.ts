import { Container, FillGradient, Graphics } from "pixi.js";

/**
 * Temporary scaffold scene: a warm dusk backdrop and an empty glass tank.
 * Replaced by the real tank renderer (render/layers/*) in the rendering task.
 * Exists to prove the render-on-demand pipeline end to end.
 */
export function buildPlaceholderScene(
  stage: Container,
  width: number,
  height: number,
): void {
  stage.removeChildren();

  const backdrop = new Graphics();
  const dusk = new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: 0x3a342b },
      { offset: 0.6, color: 0x2b2823 },
      { offset: 1, color: 0x221f1b },
    ],
    textureSpace: "local",
  });
  backdrop.rect(0, 0, width, height).fill(dusk);
  stage.addChild(backdrop);

  // Empty glass tank, centered - the world that will come alive.
  const tankWidth = Math.min(width * 0.7, 900);
  const tankHeight = Math.min(height * 0.6, 520);
  const tankX = (width - tankWidth) / 2;
  const tankY = (height - tankHeight) / 2;

  const tank = new Graphics();
  // Soft inner glow of glass
  tank
    .roundRect(tankX, tankY, tankWidth, tankHeight, 8)
    .fill({ color: 0xf2ead8, alpha: 0.04 });
  // Glass edge highlight
  tank
    .roundRect(tankX, tankY, tankWidth, tankHeight, 8)
    .stroke({ color: 0xd8cdb4, alpha: 0.35, width: 2 });
  // Sterile substrate line waiting for life
  const substrateY = tankY + tankHeight * 0.82;
  tank
    .moveTo(tankX + 3, substrateY)
    .lineTo(tankX + tankWidth - 3, substrateY)
    .stroke({ color: 0x8a6f4d, alpha: 0.5, width: 3 });

  stage.addChild(tank);
}
