import { expect, test } from "@playwright/test";

/**
 * The resilient app states, driven in a real browser: a not-found route, and the editor going
 * offline. Offline is a first-class state here — local editing has to keep working while the
 * hosted AI copilot pauses — so it is exercised against the real online/offline events.
 */

test("an unknown route lands in an actionable not-found state", async ({
  page,
}) => {
  await page.goto("/this-route-does-not-exist");
  await expect(
    page.getByRole("heading", { name: "This page doesn’t exist" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open the editor" }).click();
  await expect(
    page.getByRole("heading", { name: "Architecture workspace" }),
  ).toBeVisible();
});

test("going offline pauses the AI copilot but keeps local editing", async ({
  page,
  context,
}) => {
  await page.goto("/editor");
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();

  await context.setOffline(true);

  await expect(
    page.getByText("You’re offline — local editing still works"),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Copilot" }).click();
  await expect(
    page.getByText("AI copilot paused — you’re offline"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview request" }),
  ).toBeDisabled();

  // Local editing controls remain available while offline.
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  await context.setOffline(false);
  await expect(
    page.getByText("You’re offline — local editing still works"),
  ).toBeHidden();
});
