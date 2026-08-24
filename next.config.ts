import type { NextConfig } from "next";

import {
  API_CONTENT_SECURITY_POLICY,
  BASELINE_SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
} from "./src/lib/security-headers";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Static, nonce-free security headers for every response. The per-request Content Security
 * Policy is set in `proxy.ts` (it needs a fresh nonce); everything that does not depend on a
 * nonce lives here so it also covers API routes and static assets. HSTS is production-only so
 * local HTTP development is never pinned to HTTPS.
 */
const nextConfig: NextConfig = {
  async headers() {
    const baseline = [...BASELINE_SECURITY_HEADERS];
    if (isProduction) {
      baseline.push({
        key: "Strict-Transport-Security",
        value: STRICT_TRANSPORT_SECURITY,
      });
    }

    return [
      { source: "/(.*)", headers: baseline },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: API_CONTENT_SECURITY_POLICY,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
