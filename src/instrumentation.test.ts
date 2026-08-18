import { afterEach, describe, expect, it, vi } from "vitest";

import { onRequestError } from "@/instrumentation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Next server error instrumentation", () => {
  it("records the route template and omits the request URL, message, and stack", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = new TypeError("private diagram content");
    error.stack = "at https://example.test/editor?diagram=private";

    await onRequestError(
      error,
      {
        path: "/editor?diagram=private",
        method: "GET",
        headers: { cookie: "private" },
      },
      {
        routerKind: "App Router",
        routePath: "/editor/page",
        routeType: "render",
        renderSource: "server-rendering",
        revalidateReason: undefined,
      },
    );

    const record = String(info.mock.calls[0]?.[0]);
    expect(record).toContain('"routePath":"/editor/page"');
    expect(record).toContain('"feature":"editor"');
    expect(record).toContain('"trust":"server"');
    expect(record).toContain('"errorClass":"TypeError"');
    expect(record).not.toContain("private");
    expect(record).not.toContain("diagram=");
    expect(record).not.toContain("stack");
    expect(record).not.toContain("message");
  });
});
