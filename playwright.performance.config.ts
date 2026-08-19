import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PERFORMANCE_PORT ?? 3200);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "performance.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DESIGN_REVIEW_STORY_AGENT: "fixture" },
  },
});
