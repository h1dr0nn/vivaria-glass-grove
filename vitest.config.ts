import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      // Coverage is enforced on pure logic (sim, game loop, persistence).
      // Render/UI layers are verified visually per docs/ARCHITECTURE.md.
      // storage.ts is environment glue (Tauri/localStorage adapters)
      // exercised by scripts/e2e-save.ts instead of unit tests.
      include: ["src/sim/**", "src/persistence/**", "src/game/**"],
      exclude: ["src/**/*.test.ts", "src/persistence/storage.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
