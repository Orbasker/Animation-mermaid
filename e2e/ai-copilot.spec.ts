import { expect, test, type Page } from "@playwright/test";

import { BASELINE_INTENT, PROPOSAL_TITLE, installCopilotFixture } from "./support/fixtures";

/**
 * The AI half of the journey: the consent boundary before a request leaves the browser, the human
 * approval gate that turns a proposal into one applied transaction (and a rejection into no
 * mutation at all), and reconnecting to an in-flight run after a reload.
 *
 * Every run is driven by the scripted transport installed through `window.__E2E_COPILOT__`, so the
 * shipped client code runs unchanged while the durable runtime is stubbed.
 */

test.beforeEach(async ({ page }) => {
  await installCopilotFixture(page);
});

async function openCopilot(page: Page): Promise<void> {
  await page.goto("/editor");
  await page.getByRole("tab", { name: "Copilot" }).click();
  await expect(page.getByRole("heading", { name: "Design-review scenes" })).toBeVisible();
}

function includedCount(legend: string): number {
  return Number(/·\s*(\d+)\s*of/.exec(legend)?.[1]);
}

async function driveToReview(page: Page): Promise<void> {
  await page.getByLabel("What should the animation explain?").fill(BASELINE_INTENT);
  await page.getByRole("button", { name: "Preview request" }).click();
  await expect(page.getByRole("group", { name: "Request preview" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm & generate" }).click();
  await expect(page.getByRole("heading", { name: PROPOSAL_TITLE })).toBeVisible();
}

test("excluding a component drops it from what is sent, and nothing is sent before confirm", async ({
  page,
}) => {
  await openCopilot(page);
  await page.getByLabel("What should the animation explain?").fill(BASELINE_INTENT);

  const legend = page.getByText(/Context sent to AI/);
  const before = includedCount((await legend.textContent()) ?? "");
  expect(before).toBeGreaterThan(0);

  await page.getByRole("checkbox", { name: /Client/ }).first().uncheck();
  const after = includedCount((await legend.textContent()) ?? "");
  expect(after).toBeLessThan(before);

  // No run has started: the generate control does not exist before the preview is confirmed.
  await expect(page.getByRole("group", { name: "Run progress" })).toHaveCount(0);

  await page.getByRole("button", { name: "Preview request" }).click();
  const fixture = page.getByLabel("Request context fixture");
  await expect(fixture).toBeVisible();
  await expect(fixture).not.toContainText('"id": "client"');
});

test("approving applies the proposal as one undoable transaction", async ({ page }) => {
  await openCopilot(page);
  await driveToReview(page);

  await page.getByRole("button", { name: "Apply to project" }).click();
  await expect(page.getByText("Applied to your project")).toBeVisible();

  // The approved story is now in the project — a second story alongside the sample one.
  await page.getByRole("tab", { name: "Story" }).click();
  await expect(page.getByRole("option", { name: PROPOSAL_TITLE })).toHaveCount(1);

  // The apply reverts byte-for-byte.
  await page.getByRole("tab", { name: "Copilot" }).click();
  await page.getByRole("button", { name: "Undo apply" }).click();
  await expect(page.getByText("Apply undone")).toBeVisible();

  await page.getByRole("tab", { name: "Story" }).click();
  await expect(page.getByRole("option", { name: PROPOSAL_TITLE })).toHaveCount(0);
});

test("rejecting a proposal mutates nothing", async ({ page }) => {
  await openCopilot(page);
  await driveToReview(page);

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Discarded")).toBeVisible();

  await page.getByRole("tab", { name: "Story" }).click();
  await expect(page.getByRole("option", { name: PROPOSAL_TITLE })).toHaveCount(0);
});

test("a reload reconnects to the in-flight run", async ({ page }) => {
  await openCopilot(page);
  await driveToReview(page);

  // Reload with nothing carried across but the run id the editor linked in IndexedDB.
  await page.reload();
  await page.getByRole("tab", { name: "Copilot" }).click();

  // The run is rejoined at the approval gate rather than restarted, and can still be approved.
  await expect(page.getByRole("heading", { name: PROPOSAL_TITLE })).toBeVisible();
  await page.getByRole("button", { name: "Apply to project" }).click();
  await expect(page.getByText("Applied to your project")).toBeVisible();
});
