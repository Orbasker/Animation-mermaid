import { expect, test } from "@playwright/test";

/**
 * The dense-graph budget. The editor ships a 200-component stress fixture precisely so this path
 * can be exercised; here we load it in a real browser and hold rendering the whole graph to a
 * wall-clock budget, so a regression that makes the canvas quadratic is caught before a reviewer
 * with a big diagram hits it.
 */

const RENDER_BUDGET_MS = 6_000;

test("renders the 200-node stress fixture within budget", async ({ page }) => {
  await page.goto("/editor");
  await expect(page.getByRole("button", { name: /^Database\. Position/ })).toBeVisible();

  const started = Date.now();
  await page.getByRole("button", { name: "Load 200-node stress fixture" }).click();

  await expect(page.locator(".documentBadge")).toHaveText("200 components");
  const nodes = page.locator(".graphNode");
  await expect(nodes).toHaveCount(200);
  const elapsed = Date.now() - started;

  expect(elapsed).toBeLessThan(RENDER_BUDGET_MS);
  // The stress preview is deliberately not autosaved, so it never overwrites the real project.
  await expect(page.locator(".saveStatus")).toContainText("Stress preview");
});
