import { expect, test } from "@playwright/test";

/**
 * The resilient app states, driven in a real browser: a not-found route, and the editor going
 * offline. Offline is a first-class state here — local editing has to keep working while
 * disconnected — so it is exercised against the real online/offline events.
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

test("going offline keeps local editing available", async ({
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

  // Local editing controls remain available while offline.
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  await context.setOffline(false);
  await expect(
    page.getByText("You’re offline — local editing still works"),
  ).toBeHidden();
});
