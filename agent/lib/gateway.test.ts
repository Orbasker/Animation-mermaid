import { afterEach, describe, expect, it, vi } from "vitest";

import { FEATURE, gatewayTags, resolveEnvironment } from "./gateway";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI Gateway attribution", () => {
  it("preserves the design-review feature and Vercel environment tags", () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    expect(FEATURE).toBe("design-review");
    expect(resolveEnvironment()).toBe("preview");
    expect(gatewayTags()).toEqual(["feature:design-review", "env:preview"]);
  });

  it("falls back to the Node environment off-platform", () => {
    delete process.env.VERCEL_ENV;
    vi.stubEnv("NODE_ENV", "test");

    expect(gatewayTags()).toEqual(["feature:design-review", "env:test"]);
  });
});
