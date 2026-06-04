import { CURRENT_SAVE_VERSION } from "./saveSchema";

/**
 * Ordered pure migration chain: each step lifts schemaVersion N → N+1.
 * Runs BEFORE zod validation so old shapes can be reshaped first.
 */

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** index 0 migrates v1 → v2, etc. (none yet - v1 is current) */
const MIGRATIONS: readonly Migration[] = [];

export function migrateSave(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
  if (version < 1 || version > CURRENT_SAVE_VERSION) return null;

  let data = raw;
  for (let v = version; v < CURRENT_SAVE_VERSION; v++) {
    const migration = MIGRATIONS[v - 1];
    if (!migration) return null;
    data = { ...migration(data), schemaVersion: v + 1 };
  }
  return data;
}
