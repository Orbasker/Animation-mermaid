import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { workflow } from "@workflow/vitest";

export default defineConfig({
  plugins: [workflow()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.integration.test.ts"],
    // `.eve/dev-runtime/snapshots` holds copies of the source tree taken by `eve dev`, and
    // `.workflow-vitest` the generated bundles; without this the suite would run twice.
    exclude: [
      ...configDefaults.exclude,
      ".eve/**",
      ".output/**",
      ".vercel/**",
      ".workflow-vitest/**",
    ],
    testTimeout: 60_000,
  },
});
