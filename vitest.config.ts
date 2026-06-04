import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      // Coverage is enforced on pure logic (sim, persistence). The render/UI
      // layers are verified visually (screenshots) per docs/ARCHITECTURE.md.
      include: ["src/sim/**", "src/persistence/**"],
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
