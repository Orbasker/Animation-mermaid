import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: [
      ...configDefaults.exclude,
      ".eve/**",
      ".output/**",
      ".vercel/**",
      // Workflow integration tests need the DevKit's Vitest plugin and its own runtime;
      // they run from vitest.integration.config.mts.
      "**/*.integration.test.ts",
    ],
  },
});
