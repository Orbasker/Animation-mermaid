import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright drives the editor journey in a real browser against the local Next.js app:
 * import, edit, IndexedDB persistence across reload, and timeline seek all run against the
 * app untouched.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
// `localhost`, not `127.0.0.1`: Next dev's cross-origin protection 403s requests whose Origin is
// not an allowed dev origin, and `localhost` is the default one.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/performance.spec.ts",
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
  },
});
