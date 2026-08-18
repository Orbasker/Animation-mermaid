import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility gate. Runs axe against the two surfaces a reviewer actually uses and fails on any
 * serious or critical violation, which is the bar a design-review tool has to clear to be usable
 * with a keyboard and a screen reader.
 */

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
}

test("the home page has no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await scan(page)).toEqual([]);
});

test("the editor has no serious accessibility violations", async ({ page }) => {
  await page.goto("/editor");
  // Wait for the workspace to finish loading before scanning it.
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();
  expect(await scan(page)).toEqual([]);
});
