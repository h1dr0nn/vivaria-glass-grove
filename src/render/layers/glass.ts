import { Container, FillGradient, Graphics } from "pixi.js";
import { SCENE } from "../palette";
import type { TankLayout } from "../layout";

export interface GlassLayers {
  /** inner back wall - added BEHIND the tank contents */
  readonly back: Container;
  /** front pane, top rim, corner AO - added in front of everything */
  readonly front: Container;
}

export interface GlassFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
}

/** Shared inner-glass geometry - the content mask must match it exactly. */
export function glassFrame(layout: TankLayout): GlassFrame {
  return {
    x: layout.originX,
    y: layout.originY - layout.tankHeightPx,
    w: layout.tankWidthPx,
    h: layout.tankHeightPx,
    radius: Math.max(6, layout.scale * 1.6),
  };
}

/**
 * The glass box, cabinet-oblique: a faint inner back wall behind the scene,
 * a visible top rim receding up-right, soft inner-corner occlusion, and the
 * crisp front pane on top. Static - built once.
 */
export function buildGlass(layout: TankLayout): GlassLayers {
  const { x, y, w, h, radius } = glassFrame(layout);
  const { depthX, depthY } = layout;

  // ---------------------------------------------------------------- back
  const back = new Container();
  const backWall = new Graphics();
  backWall
    .roundRect(x + depthX, y + depthY, w, h, radius)
    .fill({ color: 0xd8d2bd, alpha: 0.35 });
  backWall
    .roundRect(x + depthX, y + depthY, w, h, radius)
    .stroke({ color: SCENE.glassEdge, alpha: 0.4, width: 1.5 });
  // bottom depth edges joining the front box to the back box - mostly
  // occluded by substrate (correct physically), they complete the volume
  // wherever the floor dips low
  backWall
    .moveTo(x + radius * 0.3, y + h - radius * 0.3)
    .lineTo(x + depthX + radius * 0.3, y + h + depthY - radius * 0.3)
    .moveTo(x + w - radius * 0.3, y + h - radius * 0.3)
    .lineTo(x + w + depthX - radius * 0.3, y + h + depthY - radius * 0.3)
    .stroke({ color: SCENE.glassEdge, alpha: 0.4, width: 1.5 });
  back.addChild(backWall);

  // --------------------------------------------------------------- front
  const front = new Container();

  // top rim - the open mouth of the tank seen slightly from above
  const rim = new Graphics();
  const rimGradient = new FillGradient({
    type: "linear",
    start: { x: 0, y: 1 },
    end: { x: 0, y: 0 },
    colorStops: [
      { offset: 0, color: 0xf6f2e4 },
      { offset: 1, color: 0xddd8c4 },
    ],
    textureSpace: "local",
  });
  rim
    .poly([
      x, y,
      x + w, y,
      x + w + depthX, y + depthY,
      x + depthX, y + depthY,
    ])
    .fill(rimGradient);
  rim.alpha = 0.85;
  // far lip
  rim
    .moveTo(x + depthX, y + depthY)
    .lineTo(x + w + depthX, y + depthY)
    .stroke({ color: 0xffffff, alpha: 0.65, width: 1.5 });
  // the rim's slanted sides ARE the top depth edges - stroking them joins
  // each front-top corner to its back-top corner so the two boxes read as
  // ONE see-through volume, not two rectangles stacked (the line must be
  // a step darker than the rim or it vanishes against it)
  rim
    .moveTo(x + radius * 0.3, y + radius * 0.1)
    .lineTo(x + depthX + radius * 0.3, y + depthY + radius * 0.1)
    .moveTo(x + w - radius * 0.3, y + radius * 0.1)
    .lineTo(x + w + depthX - radius * 0.3, y + depthY + radius * 0.1)
    .stroke({ color: 0xb6ae96, alpha: 0.75, width: 1.5 });
  // right rim sliver (the receding side wall's top edge)
  rim
    .poly([
      x + w, y,
      x + w + depthX, y + depthY,
      x + w + depthX, y + depthY + h * 0.12,
      x + w, y + h * 0.1,
    ])
    .fill({ color: 0xe8e2cf, alpha: 0.4 });
  front.addChild(rim);

  // inner-corner ambient occlusion - contents sit IN a box, tinted not black
  const ao = new Graphics();
  const aoWidth = layout.scale * 2.2;
  const sideGradient = (flip: boolean): FillGradient =>
    new FillGradient({
      type: "linear",
      start: { x: flip ? 1 : 0, y: 0 },
      end: { x: flip ? 0 : 1, y: 0 },
      colorStops: [
        { offset: 0, color: SCENE.glassShadow },
        { offset: 1, color: SCENE.glassShadow },
      ],
      textureSpace: "local",
    });
  void sideGradient;
  ao.rect(x, y, aoWidth, h).fill({ color: SCENE.glassShadow, alpha: 0.1 });
  ao.rect(x + w - aoWidth, y, aoWidth, h).fill({
    color: SCENE.glassShadow,
    alpha: 0.1,
  });
  ao.rect(x, y + h - aoWidth * 0.8, w, aoWidth * 0.8).fill({
    color: SCENE.glassShadow,
    alpha: 0.12,
  });
  front.addChild(ao);

  // subtle vertical sheen across the pane
  const sheen = new Graphics();
  sheen
    .poly([
      x + w * 0.08, y + 4,
      x + w * 0.16, y + 4,
      x + w * 0.1, y + h - 4,
      x + w * 0.04, y + h - 4,
    ])
    .fill({ color: 0xffffff, alpha: 0.05 });
  front.addChild(sheen);

  const frame = new Graphics();
  // inner shadow hugging the glass walls (tinted, never black)
  frame
    .roundRect(x + 1.5, y + 1.5, w - 3, h - 3, radius)
    .stroke({ color: SCENE.glassShadow, alpha: 0.18, width: 4 });
  // crisp glass edge
  frame
    .roundRect(x, y, w, h, radius)
    .stroke({ color: SCENE.glassEdge, alpha: 0.9, width: 2 });
  // near lip highlight
  frame
    .moveTo(x + radius, y + 1)
    .lineTo(x + w - radius, y + 1)
    .stroke({ color: 0xffffff, alpha: 0.55, width: 1.5 });
  front.addChild(frame);

  return { back, front };
}
