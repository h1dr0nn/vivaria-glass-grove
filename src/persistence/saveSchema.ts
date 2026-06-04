import { z } from "zod";

/**
 * Save file schema. Treat the file as untrusted input — everything is
 * validated at the boundary (docs/ARCHITECTURE.md → Persistence).
 */

export const CURRENT_SAVE_VERSION = 1;

const phaseSchema = z.enum([
  "sterile",
  "microbes",
  "algae",
  "plants",
  "fauna",
]);

const scalar01 = z.number().min(0).max(1);

export const saveSchema = z.object({
  schemaVersion: z.number().int().min(1),
  tunablesHash: z.string(),
  savedAtUnixMs: z.number().nonnegative(),
  seed: z.number().int().nonnegative(),
  landPercent: z.number().min(0).max(100),
  genVersion: z.number().int().min(1),
  sim: z.object({
    simTimeMs: z.number().nonnegative(),
    phase: phaseSchema,
    scalars: z.object({
      microbes: scalar01,
      algae: scalar01,
      plants: scalar01,
    }),
    pools: z.object({
      nutrients: z.number().min(0),
    }),
  }),
  discoveries: z.array(
    z.object({
      phase: phaseSchema,
      atSimTimeMs: z.number().nonnegative(),
    }),
  ),
  // .default keeps pre-species saves loadable without a migration
  speciesDiscovered: z
    .array(
      z.object({
        id: z.string().min(1),
        atSimTimeMs: z.number().nonnegative(),
      }),
    )
    .default([]),
});

export type SaveData = z.infer<typeof saveSchema>;
