import { expect, test } from "@playwright/test";

/**
 * The deterministic half of the design-review journey, driven in a real browser against the app
 * untouched: import → edit → persistence across reload → timeline seek → comparison. No workflow
 * runtime is involved; the AI half lives in `ai-copilot.spec.ts`.
 */

test("home links into the editor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Turn Mermaid diagrams into motion/i })).toBeVisible();
  await page.getByRole("link", { name: /Open the editor/i }).click();
  await expect(page.getByRole("heading", { name: "Architecture workspace" })).toBeVisible();
});

test("imported Mermaid source is shown and stays read-only", async ({ page }) => {
  await page.goto("/editor");
  await page.getByRole("tab", { name: "Source" }).click();
  const source = page.locator("pre.sourceCode");
  await expect(source).toContainText("flowchart TD");
  await expect(source).toContainText("client[Client]");
  await expect(page.getByText("Visual changes never rewrite this source.")).toBeVisible();
});

test("a keyboard move autosaves and survives a reload", async ({ page }) => {
  await page.goto("/editor");

  const node = page.getByRole("button", { name: /^Database\. Position/ });
  await expect(node).toBeVisible();

  const before = await node.getAttribute("aria-label");
  const beforeX = Number(/Position (-?\d+),/.exec(before ?? "")?.[1]);
  expect(Number.isFinite(beforeX)).toBe(true);

  await node.click();
  await node.press("ArrowRight");

  const movedName = new RegExp(`^Database\\. Position ${beforeX + 10},`);
  await expect(page.getByRole("button", { name: movedName })).toBeVisible();
  await expect(page.locator(".saveStatus")).toHaveText("Saved locally");

  await page.reload();

  // The move was written to IndexedDB in one transaction, so it comes back after the reload.
  await expect(page.getByRole("button", { name: movedName })).toBeVisible();
});

test("the timeline previews and seeks to an arbitrary position", async ({ page }) => {
  await page.goto("/editor");
  await page.getByRole("tab", { name: "Story" }).click();

  await expect(page.getByRole("heading", { name: "Scene timeline" })).toBeVisible();
  await page.getByRole("button", { name: "Enter preview" }).click();

  const playhead = page.getByRole("status").getByText(/\/ 3700 ms$/).first();
  await expect(playhead).toBeVisible();

  await page.getByLabel("Scrubber").fill("2000");
  await expect(page.getByText(/^2000 \/ 3700 ms$/).first()).toBeVisible();
});

test("the comparison surface reports the semantic diff", async ({ page }) => {
  await page.goto("/editor");
  await page.getByRole("tab", { name: "Compare" }).click();

  await expect(page.getByRole("heading", { name: "Current vs proposed" })).toBeVisible();
  await expect(page.getByText(/\d+ semantic changes/)).toBeVisible();
});
