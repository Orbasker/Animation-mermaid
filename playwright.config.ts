import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright drives the full design-review journey in a real browser against the local Next.js
 * app. The deterministic client parts (import, edit, IndexedDB persistence across reload,
 * timeline seek, comparison) run against the app untouched; the AI approval and reconnect
 * journeys install a scripted copilot transport via `window.__E2E_COPILOT__` (see
 * `src/app/editor/ai-copilot/e2e-transport.ts`) so they never need a live workflow runtime or a
 * Gateway credential.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
// `localhost`, not `127.0.0.1`: Next dev's cross-origin protection 403s requests whose Origin is
// not an allowed dev origin, and `localhost` is the default one.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // The editor never reaches this in the mocked journeys, but keep runs off a real Gateway.
      DESIGN_REVIEW_STORY_AGENT: "fixture",
    },
  },
});
