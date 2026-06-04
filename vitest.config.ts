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
      include: ["src/sim/**", "src/persistence/**", "src/game/**"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
