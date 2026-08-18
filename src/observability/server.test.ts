import { afterEach, describe, expect, it, vi } from "vitest";

import {
  featureForServerRoute,
  recordObservabilityEvent,
} from "@/observability/server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server observability", () => {
  it.each([
    ["/page", "site"],
    ["/editor/page", "editor"],
    ["/api/design-review-story/[runId]/proposal/route", "design-review"],
    ["/api/observability/route", "observability"],
    ["/concrete/private/path", "unmapped"],
  ])("maps the allowlisted route template %s to %s", (routePath, feature) => {
    expect(featureForServerRoute(routePath)).toBe(feature);
  });

  it("does not emit when a production release identity is unavailable", () => {
    const environment = process.env.VERCEL_ENV;
    const release = process.env.OBSERVABILITY_RELEASE;
    const commit = process.env.VERCEL_GIT_COMMIT_SHA;
    const deployment = process.env.VERCEL_DEPLOYMENT_ID;
    process.env.VERCEL_ENV = "production";
    delete process.env.OBSERVABILITY_RELEASE;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      expect(
        recordObservabilityEvent({
          type: "server_error",
          errorClass: "Error",
          routerKind: "App Router",
          routePath: "/editor",
          routeType: "render",
        }),
      ).toBe(false);
      expect(info).not.toHaveBeenCalled();
    } finally {
      if (environment === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = environment;
      if (release === undefined) delete process.env.OBSERVABILITY_RELEASE;
      else process.env.OBSERVABILITY_RELEASE = release;
      if (commit === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = commit;
      if (deployment === undefined) delete process.env.VERCEL_DEPLOYMENT_ID;
      else process.env.VERCEL_DEPLOYMENT_ID = deployment;
    }
  });
});
