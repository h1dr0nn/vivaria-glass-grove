import { mulberry32, splitSeed } from "../rng";
import { STREAMS } from "./terrain";
import { MATERIAL, cellIndex, type HardscapePiece } from "./types";

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

  const rockCount = 1 + Math.floor(rng() * 3);
  for (let r = 0; r < rockCount; r++) {
    const piece = tryPlace(rng, pieces, width, (x) => ({
      kind: "rock" as const,
      x,
      y: terrain[x],
      halfWidth: 3 + Math.floor(rng() * 4),
      halfHeight: 2 + Math.floor(rng() * 2),
    }));
    if (piece && piece.y + piece.halfHeight < usableHeight) pieces.push(piece);
  }

  const woodCount = rng() < 0.65 ? 1 : 2;
  const shoreColumns = collectShoreColumns(terrain, waterlineY, width);
  for (let w = 0; w < woodCount; w++) {
    const pickFrom = shoreColumns.length > 0 ? shoreColumns : null;
    const piece = tryPlace(
      rng,
      pieces,
      width,
      (x) => ({
        kind: "driftwood" as const,
        x,
        y: terrain[x] + 1,
        halfWidth: 8 + Math.floor(rng() * 7),
        halfHeight: 1 + Math.floor(rng() * 2),
      }),
      pickFrom,
    );
    if (piece && piece.y + piece.halfHeight < usableHeight) pieces.push(piece);
  }

  return pieces;
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
): HardscapePiece | null {
  for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
    const x = candidates
      ? candidates[Math.floor(rng() * candidates.length)]
      : 8 + Math.floor(rng() * (width - 16));
    const tooClose = existing.some(
      (p) => Math.abs(p.x - x) < MIN_PIECE_DISTANCE,
    );
    if (!tooClose) return make(x);
  }
  return null;
}

/** Stamp pieces into the material grid as half-buried ellipses. */
export function stampHardscape(
  materials: Uint8Array,
  pieces: readonly HardscapePiece[],
  width: number,
  height: number,
): void {
  for (const piece of pieces) {
    const material = piece.kind === "rock" ? MATERIAL.rock : MATERIAL.wood;
    const x0 = Math.max(0, piece.x - piece.halfWidth);
    const x1 = Math.min(width - 1, piece.x + piece.halfWidth);
    const y0 = Math.max(0, piece.y - piece.halfHeight);
    const y1 = Math.min(height - 1, piece.y + piece.halfHeight);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - piece.x) / piece.halfWidth;
        const dy = (y - piece.y) / piece.halfHeight;
        if (dx * dx + dy * dy <= 1) {
          materials[cellIndex(width, x, y)] = material;
        }
      }
    }
  }
}
