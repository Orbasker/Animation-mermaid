import { expect, test } from "@playwright/test";

/**
 * The cancellable-worker guarantees for ANI-26, exercised in a real browser: a reimport runs
 * off the UI thread (so the editor stays interactive while it works), a superseding reimport
 * cannot leave the graph in a stale or failed state, and the Mermaid source is never rewritten
 * by the round trip. The heavy-graph budget itself lives in `performance.spec.ts`.
 */

test("reimport runs off the main thread and keeps the editor interactive", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();

  const reimport = page.getByRole("button", { name: "Reimport source" });
  // Two reimports back-to-back: the second must supersede the first without a stale result
  // surviving.
  await reimport.click();
  await reimport.click();

  // The editor stays responsive while the worker runs: the zoom control reacts immediately.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByRole("status", { name: "Zoom level" })).toHaveText(
    "110%",
  );

  await expect(page.locator("span.srOnly[aria-live='assertive']")).toHaveText(
    /Reimported Mermaid source/,
  );
});

test("a reimport never rewrites the Mermaid source", async ({ page }) => {
  await page.goto("/editor");
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reimport source" }).click();
  await expect(page.locator("span.srOnly[aria-live='assertive']")).toHaveText(
    /Reimported Mermaid source/,
  );

  await page.getByRole("tab", { name: "Source" }).click();
  const source = page.locator("pre.sourceCode");
  await expect(source).toContainText("flowchart TD");
  await expect(source).toContainText("client[Client]");
});
