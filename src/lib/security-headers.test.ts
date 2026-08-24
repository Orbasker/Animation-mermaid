import { describe, expect, it } from "vitest";

import {
  API_CONTENT_SECURITY_POLICY,
  BASELINE_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  generateNonce,
  PERMISSIONS_POLICY,
  STRICT_TRANSPORT_SECURITY,
} from "@/lib/security-headers";

/** Parses a CSP string into a directive → value-list map for order-independent assertions. */
function parseCsp(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name, values);
  }
  return map;
}

describe("buildContentSecurityPolicy", () => {
  it("locks script execution to the request nonce, never unrestricted inline", () => {
    const csp = buildContentSecurityPolicy({ nonce: "abc123" });
    const directives = parseCsp(csp);

    expect(directives.get("script-src")).toEqual([
      "'self'",
      "'nonce-abc123'",
      "'strict-dynamic'",
    ]);
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
    expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("declares the directives the editor, workers, AI routes, and diagrams need", () => {
    const directives = parseCsp(buildContentSecurityPolicy({ nonce: "n" }));

    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    // Inline styles are an intentional, script-free relaxation for animation transforms.
    expect(directives.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("upgrades insecure requests in production but not development", () => {
    expect(buildContentSecurityPolicy({ nonce: "n" })).toContain(
      "upgrade-insecure-requests",
    );
    expect(
      buildContentSecurityPolicy({ nonce: "n", isDev: true }),
    ).not.toContain("upgrade-insecure-requests");
  });

  it("only loosens script-src and connect-src for local development tooling", () => {
    const directives = parseCsp(
      buildContentSecurityPolicy({ nonce: "n", isDev: true }),
    );

    expect(directives.get("script-src")).toContain("'unsafe-eval'");
    expect(directives.get("connect-src")).toEqual(["'self'", "ws:", "wss:"]);
  });
});

describe("generateNonce", () => {
  it("produces unique, base64, sufficiently long nonces", () => {
    const a = generateNonce();
    const b = generateNonce();

    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // 16 random bytes → 24 base64 characters.
    expect(a.length).toBeGreaterThanOrEqual(20);
  });
});

describe("baseline headers", () => {
  it("sets the agreed frame, sniffing, referrer, and isolation headers", () => {
    const byKey = new Map(
      BASELINE_SECURITY_HEADERS.map((h) => [h.key, h.value]),
    );

    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(byKey.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(byKey.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(byKey.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY);
    // HSTS is production-only and is added by next.config, not carried in the baseline set.
    expect(byKey.has("Strict-Transport-Security")).toBe(false);
  });

  it("denies the powerful features the app never uses", () => {
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    }
  });

  it("pins HSTS to two years with subdomains and preload", () => {
    expect(STRICT_TRANSPORT_SECURITY).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });
});

describe("API content security policy", () => {
  it("denies everything by default for JSON routes", () => {
    const directives = parseCsp(API_CONTENT_SECURITY_POLICY);
    expect(directives.get("default-src")).toEqual(["'none'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
  });
});
