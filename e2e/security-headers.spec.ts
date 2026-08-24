import { expect, test } from "@playwright/test";

/**
 * End-to-end proof for ANI-28: the running app returns the agreed security headers, the document
 * CSP is nonce-based (never `'unsafe-inline'`/`'unsafe-eval'` in `script-src`), and the editor
 * boots and imports a diagram under that enforced policy with no CSP violations reported by the
 * browser. Header assertions here fail if the policy is removed or weakened.
 */

test("document responses carry a nonce-based CSP and the baseline headers", async ({
  page,
}) => {
  const response = await page.goto("/editor");
  expect(response).not.toBeNull();

  const headers = response!.headers();

  const csp = headers["content-security-policy"];
  expect(csp).toBeTruthy();
  expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/]+=*'/);
  expect(csp).toMatch(/script-src[^;]*'strict-dynamic'/);
  const scriptSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src"))!;
  // No unrestricted inline script in either mode. (`'unsafe-eval'` is present only under
  // `next dev`, which this web server runs; the production policy is asserted in the unit and
  // proxy tests.)
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("worker-src 'self' blob:");

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
});

test("the editor boots and imports under the enforced CSP with no violations", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|apply)/i.test(text)) {
      violations.push(text);
    }
  });

  await page.goto("/editor");

  // The worker-backed import path renders the diagram — this exercises worker-src and the
  // bundled scripts admitted through the nonce + strict-dynamic.
  await expect(
    page.getByRole("button", { name: /^Database\. Position/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reimport source" }).click();
  await expect(page.locator("span.srOnly[aria-live='assertive']")).toHaveText(
    /Reimported Mermaid source/,
  );

  expect(violations).toEqual([]);
});
