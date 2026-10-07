import { defineConfig } from "vitest/config";

// Only agentMon's own tests — the reference repo clones under reference/
// (gitignored) carry their own suites, which must never run here.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
