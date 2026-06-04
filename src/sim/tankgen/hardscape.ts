import { mulberry32, splitSeed } from "../rng";
import { STREAMS } from "./terrain";
import type { HardscapePiece } from "./types";

/**
 * STEP 4 — hardscape: a few rocks plus driftwood near the waterline,
 * Poisson-disk-spaced (rejection sampling, seeded) so pieces never crowd.
 * Driftwood prefers the shore band — it becomes the moss "wick" later.
 */

const MIN_PIECE_DISTANCE = 18;
const PLACEMENT_TRIES = 30;

export function placeHardscape(
  terrain: readonly number[],
  waterlineY: number,
  width: number,
  usableHeight: number,
  seed: number,
): HardscapePiece[] {
  const rng = mulberry32(splitSeed(seed, STREAMS.hardscape));
  const pieces: HardscapePiece[] = [];

  // a log on a steep bank reads as a plank/ramp — driftwood only rests on
  // genuinely FLAT ground (basin floor, beach flat, hilltop)
  const isValid = (piece: HardscapePiece): boolean =>
    piece.y + piece.halfHeight < usableHeight &&
    slopeAcross(terrain, piece.x, piece.halfWidth) <= 3;

  const woodCount = rng() < 0.65 ? 1 : 2;
  const flatNearShore: number[] = [];
  const flatAnywhere: number[] = [];
  for (let x = 10; x < width - 10; x++) {
    if (slopeAcross(terrain, x, 10) > 3) continue;
    flatAnywhere.push(x);
    if (waterlineY > 0 && Math.abs(terrain[x] - waterlineY) <= 6) {
      flatNearShore.push(x);
    }
  }
  for (let w = 0; w < woodCount; w++) {
    const make = (x: number): HardscapePiece => {
      const halfWidth = 8 + Math.floor(rng() * 7);
      // the log must rest fully INSIDE the glass — never through a wall
      const cx = Math.min(width - 2 - halfWidth, Math.max(halfWidth + 2, x));
      return {
        kind: "driftwood" as const,
        x: cx,
        y: terrain[cx] + 1,
        halfWidth,
        halfHeight: 1 + Math.floor(rng() * 2),
      };
    };
    const pickFrom = flatNearShore.length > 0 ? flatNearShore : flatAnywhere;
    let piece = tryPlace(
      rng,
      pieces,
      width,
      make,
      pickFrom.length > 0 ? pickFrom : null,
      isValid,
    );
    if (!piece && pickFrom === flatNearShore && flatAnywhere.length > 0) {
      piece = tryPlace(rng, pieces, width, make, flatAnywhere, isValid);
    }
    if (piece) pieces.push(piece);
  }

  return pieces;
}

/** Height variation across a piece's footprint (cells). */
function slopeAcross(
  terrain: readonly number[],
  x: number,
  halfWidth: number,
): number {
  const x0 = Math.max(0, x - halfWidth);
  const x1 = Math.min(terrain.length - 1, x + halfWidth);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = x0; i <= x1; i++) {
    min = Math.min(min, terrain[i]);
    max = Math.max(max, terrain[i]);
  }
  return max - min;
}

function tryPlace(
  rng: () => number,
  existing: readonly HardscapePiece[],
  width: number,
  make: (x: number) => HardscapePiece,
  candidates: readonly number[] | null = null,
  isValid: (piece: HardscapePiece) => boolean = () => true,
): HardscapePiece | null {
  for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
    const x = candidates
      ? candidates[Math.floor(rng() * candidates.length)]
      : 8 + Math.floor(rng() * (width - 16));
    const tooClose = existing.some(
      (p) => Math.abs(p.x - x) < MIN_PIECE_DISTANCE,
    );
    if (tooClose) continue;
    const piece = make(x);
    if (isValid(piece)) return piece;
  }
  return null;
}

