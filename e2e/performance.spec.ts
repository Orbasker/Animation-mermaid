import { expect, test } from "@playwright/test";

import budgets from "../tools/performance-budgets.json";

test("keeps editor route payload and editor-ready load within budget", async ({
  page,
}) => {
  await page.goto("/editor", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();

  const measured = await page.evaluate(() => {
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    const routeJavaScriptBytes = (
      performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    )
      .filter((entry) => {
        const path = new URL(entry.name).pathname;
        return (
          path.startsWith("/_next/static/") &&
          path.endsWith(".js") &&
          entry.initiatorType === "script"
        );
      })
      .reduce((total, entry) => total + entry.transferSize, 0);
    return {
      editorReadyMs: performance.now() - navigation.startTime,
      routeJavaScriptBytes,
    };
  });

  expect(measured.routeJavaScriptBytes).toBeGreaterThan(0);
  expect(measured.routeJavaScriptBytes).toBeLessThanOrEqual(
    budgets.bundle.editorRouteJavaScriptBytes,
  );
  expect(measured.editorReadyMs).toBeLessThanOrEqual(
    budgets.browser.editorReadyMs,
  );
});

async function measuredSurfaceSwitch(
  page: import("@playwright/test").Page,
  tab: "Layers" | "Source",
  heading: "Layers" | "Mermaid source",
): Promise<number> {
  await page.evaluate(() => performance.mark("interaction-start"));
  await page.getByRole("tab", { name: tab }).click();
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  return page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(
              performance.now() -
                performance.getEntriesByName("interaction-start").at(-1)!
                  .startTime,
            ),
          ),
        ),
      ),
  );
}

test("keeps cold and warm editor surface interactions within budget", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();

  const coldSwitchMs = await measuredSurfaceSwitch(page, "Layers", "Layers");
  expect(coldSwitchMs).toBeLessThanOrEqual(
    budgets.browser.coldSurfaceInteractionMs,
  );

  const warmSwitchMeasurements: number[] = [];
  for (let sample = 0; sample < 3; sample += 1) {
    await page.getByRole("tab", { name: "Source" }).click();
    await expect(
      page.getByRole("heading", { name: "Mermaid source" }),
    ).toBeVisible();
    warmSwitchMeasurements.push(
      await measuredSurfaceSwitch(page, "Layers", "Layers"),
    );
  }
  warmSwitchMeasurements.sort((left, right) => left - right);

  expect(warmSwitchMeasurements[1]).toBeLessThanOrEqual(
    budgets.browser.warmSurfaceInteractionMs,
  );
});

test("renders the 200-node stress fixture within budget", async ({ page }) => {
  await page.goto("/editor");
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();

  await page.evaluate(() => performance.mark("canvas-start"));
  await page
    .getByRole("button", { name: "Load 200-node stress fixture" })
    .click();

  await expect(page.locator(".documentBadge")).toHaveText("200 components");
  const nodes = page.locator(".graphNode");
  await expect(nodes).toHaveCount(200);
  const elapsed = await page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(
              performance.now() -
                performance.getEntriesByName("canvas-start").at(-1)!.startTime,
            ),
          ),
        ),
      ),
  );

  expect(elapsed).toBeLessThanOrEqual(budgets.browser.canvas200RenderMs);
  await expect(page.locator(".saveStatus")).toContainText("Stress preview");
});
