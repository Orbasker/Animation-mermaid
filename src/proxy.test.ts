import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "@/proxy";

function requestFor(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://example.com"));
}

describe("proxy security headers", () => {
  it("sets a nonce-based CSP on the response", () => {
    const response = proxy(requestFor("/editor"));

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/]+={0,2}'/);
    expect(csp).toContain("'strict-dynamic'");
  });

  it("generates a fresh nonce per request", () => {
    const first = proxy(requestFor("/editor")).headers.get(
      "Content-Security-Policy",
    );
    const second = proxy(requestFor("/editor")).headers.get(
      "Content-Security-Policy",
    );

    expect(first).not.toEqual(second);
  });

  it("never admits unrestricted inline or eval script in production", () => {
    const csp =
      proxy(requestFor("/")).headers.get("Content-Security-Policy") ?? "";
    const scriptSrc = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));

    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("skips API routes, static assets, and prefetches", () => {
    const source = (config.matcher[0] as { source: string }).source;
    const pattern = new RegExp(`^${source}$`);

    expect(pattern.test("/editor")).toBe(true);
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/api/observability")).toBe(false);
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
    expect(pattern.test("/favicon.ico")).toBe(false);
  });
});
