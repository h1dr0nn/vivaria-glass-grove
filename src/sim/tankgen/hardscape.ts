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

  // driftwood lies ALONG the bank (rendered rotated to the slope), so only
  // true cliffs are rejected (rocks were cut by design review)
  const isValid = (piece: HardscapePiece): boolean =>
    piece.y + piece.halfHeight < usableHeight &&
    slopeAcross(terrain, piece.x, piece.halfWidth) <= piece.halfWidth * 2.5;

  const woodCount = rng() < 0.65 ? 1 : 2;
  const shoreColumns = collectShoreColumns(terrain, waterlineY, width);
  for (let w = 0; w < woodCount; w++) {
    const make = (x: number): HardscapePiece => ({
      kind: "driftwood" as const,
      x,
      y: terrain[x] + 1,
      halfWidth: 8 + Math.floor(rng() * 7),
      halfHeight: 1 + Math.floor(rng() * 2),
    });
    const pickFrom = shoreColumns.length > 0 ? shoreColumns : null;
    let piece = tryPlace(rng, pieces, width, make, pickFrom, isValid);
    if (!piece && pickFrom) {
      // shore too steep everywhere — let the log rest anywhere sane
      piece = tryPlace(rng, pieces, width, make, null, isValid);
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

function collectShoreColumns(
  terrain: readonly number[],
  waterlineY: number,
  width: number,
): number[] {
  if (waterlineY <= 0) return [];
  const columns: number[] = [];
  for (let x = 8; x < width - 8; x++) {
    if (Math.abs(terrain[x] - waterlineY) <= 4) columns.push(x);
  }
  return columns;
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

