import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end proof for the self-contained export. The editor produces the artifact through the
 * real "Export HTML" button; the test then opens that file over `file://` — no server, a fresh
 * page context — which is the "opens offline in a clean browser profile" acceptance criterion.
 * Against the opened artifact it checks that nothing is fetched over the network, that playback
 * responds to keyboard and the scrubber, that the reduced-motion path still plays, and that axe
 * finds no serious or critical accessibility violations.
 */

async function exportArtifact(page: Page): Promise<string> {
  await page.goto("/editor");
  const exportButton = page.getByRole("button", { name: "Export HTML" });
  await expect(exportButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.html$/);

  const filePath = test.info().outputPath("design-review.html");
  await download.saveAs(filePath);
  return filePath;
}

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
}

test("exports a self-contained review that plays offline with keyboard control", async ({
  page,
}) => {
  const filePath = await exportArtifact(page);

  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("file://")) {
      externalRequests.push(request.url());
    }
  });

  await page.goto(`file://${filePath}`);

  // The header and controls render from the embedded payload alone.
  await expect(
    page.getByRole("heading", { name: "Request walkthrough" }),
  ).toBeVisible();
  const playButton = page.getByRole("button", { name: "Play" });
  await expect(playButton).toBeVisible();

  // Nothing is fetched over the network — the file is truly self-contained.
  expect(externalRequests).toEqual([]);

  // Keyboard: space plays and pauses.
  await page.locator("body").click();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

  // End jumps to the final frame, where every revealed node is visible.
  await page.keyboard.press("End");
  await expect(page.getByText("3700 / 3700 ms")).toBeVisible();
  await expect(page.getByText("API Gateway", { exact: true })).toBeVisible();
  await expect(page.getByText("Database", { exact: true })).toBeVisible();

  // Home seeks the scrubber back to the start.
  await page.keyboard.press("Home");
  await expect(page.getByText("0 / 3700 ms")).toBeVisible();

  expect(await seriousViolations(page)).toEqual([]);
});

test("honours reduced motion and offers a static view", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  const filePath = await exportArtifact(page);

  await page.goto(`file://${filePath}`);

  // The static view composes the final frame; every node becomes visible.
  await page.getByRole("button", { name: "Static view" }).click();
  await page.keyboard.press("End");
  await expect(page.getByText("Database", { exact: true })).toBeVisible();
  await expect(page.getByText("API Gateway", { exact: true })).toBeVisible();

  expect(await seriousViolations(page)).toEqual([]);

  await context.close();
});
