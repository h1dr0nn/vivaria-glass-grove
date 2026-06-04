import { createEffect } from "solid-js";
import { MATERIAL, cellIndex, generateTank } from "../sim/tankgen";

const PREVIEW_COLORS: Record<number, string> = {
  [MATERIAL.air]: "#f0e7d2",
  [MATERIAL.water]: "#7fb2c4",
  [MATERIAL.drainage]: "#7d746a",
  [MATERIAL.soil]: "#5d4734",
  [MATERIAL.sand]: "#d9c69c",
  [MATERIAL.litter]: "#8f6c46",
  [MATERIAL.rock]: "#8d8a82",
  [MATERIAL.wood]: "#7a5a3a",
};

interface TankPreviewProps {
  seed: number;
  land: number;
}

/** Live deterministic preview of the world a (seed, land) pair will grow. */
export default function TankPreview(props: TankPreviewProps) {
  let canvas: HTMLCanvasElement | undefined;

  createEffect(() => {
    const seed = props.seed;
    const land = props.land;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tank = generateTank(seed, land);
    const scaleX = canvas.width / tank.width;
    const scaleY = canvas.height / tank.height;

    for (let x = 0; x < tank.width; x++) {
      for (let y = 0; y < tank.height; y++) {
        const material = tank.materials[cellIndex(tank.width, x, y)];
        ctx.fillStyle = PREVIEW_COLORS[material] ?? "#f0e7d2";
        ctx.fillRect(
          x * scaleX,
          (tank.height - 1 - y) * scaleY,
          scaleX + 0.5,
          scaleY + 0.5,
        );
      }
    }
    // waterline glint
    if (tank.waterlineY > 0) {
      ctx.fillStyle = "rgba(240, 250, 245, 0.6)";
      ctx.fillRect(
        0,
        (tank.height - tank.waterlineY) * scaleY,
        canvas.width,
        1.2,
      );
    }
  });

  return (
    <canvas
      ref={canvas}
      width={384}
      height={216}
      class="tank-preview"
      aria-label="Tank preview"
    />
  );
}
