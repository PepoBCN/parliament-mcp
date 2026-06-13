import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Live API calls (semantic search + Claude summaries) are slow.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // The e2e suite spawns one stdio server and shares it across tests, so
    // tests must run in order, not in parallel.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
