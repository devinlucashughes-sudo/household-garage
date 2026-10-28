import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": resolve("tests/server-only.ts"),
      "@": resolve("src"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
