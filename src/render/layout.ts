import type { TankState } from "../sim/tankgen";

/** Maps tank cell coordinates (y up from the floor) to screen pixels. */
export interface TankLayout {
  /** pixels per cell */
  readonly scale: number;
  /** screen x of the tank's inner-left wall */
  readonly originX: number;
  /** screen y of the tank's inner floor (y grows downward on screen) */
  readonly originY: number;
  readonly tankWidthPx: number;
  readonly tankHeightPx: number;
  /** cabinet-oblique receding-depth vector: back plane = front + (depthX, depthY) */
  readonly depthX: number;
  readonly depthY: number;
}

const HORIZONTAL_FILL = 0.78;
const VERTICAL_FILL = 0.74;
/** how deep the visible top faces read, in cells */
const DEPTH_CELLS = 3;
/** recede angle — mostly vertical so the rim reads as seen slightly from above */
const DEPTH_ANGLE_RAD = (62 * Math.PI) / 180;

export function computeLayout(
  viewWidth: number,
  viewHeight: number,
  tank: TankState,
): TankLayout {
  const scale = Math.min(
    (viewWidth * HORIZONTAL_FILL) / tank.width,
    (viewHeight * VERTICAL_FILL) / tank.height,
  );
  const tankWidthPx = tank.width * scale;
  const tankHeightPx = tank.height * scale;
  const depthPx = scale * DEPTH_CELLS;
  return {
    scale,
    originX: (viewWidth - tankWidthPx) / 2,
    originY: (viewHeight + tankHeightPx) / 2,
    tankWidthPx,
    tankHeightPx,
    depthX: depthPx * Math.cos(DEPTH_ANGLE_RAD),
    depthY: -depthPx * Math.sin(DEPTH_ANGLE_RAD),
  };
}

export function screenX(layout: TankLayout, cellX: number): number {
  return layout.originX + cellX * layout.scale;
}

export function screenY(layout: TankLayout, cellY: number): number {
  return layout.originY - cellY * layout.scale;
}
