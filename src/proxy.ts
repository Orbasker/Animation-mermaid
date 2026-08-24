import { NextResponse, type NextRequest } from "next/server";

import {
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/security-headers";

/**
 * Attaches a per-request, nonce-based Content Security Policy to every document response.
 *
 * A fresh nonce is generated per request and placed on the outgoing `Content-Security-Policy`
 * header and on an `x-nonce` request header. Next.js reads that `'nonce-…'` from the CSP during
 * server rendering and stamps it onto its own inline and bundled scripts, so the strict
 * `script-src` admits the framework's code while rejecting any injected script — including one
 * smuggled through a user-authored diagram label or link.
 *
 * The remaining static security headers are set in `next.config.ts` so they also cover the
 * static assets and API routes this proxy deliberately skips.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV === "development";
  const csp = buildContentSecurityPolicy({ nonce, isDev });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every document request, but skip paths that never render an HTML document and so
     * cannot carry a nonce-bearing script: API routes (JSON — see the static CSP in
     * next.config.ts), the Next.js static and image pipelines, well-known probes, and favicon.
     * `next/link` prefetches are skipped too so a prefetched shell is not pinned to a stale
     * nonce.
     */
    {
      source:
        "/((?!api|_next/static|_next/image|\\.well-known|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
