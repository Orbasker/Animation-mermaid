/**
 * The single source of truth for the app's HTTP security headers. `proxy.ts` sets the
 * per-request Content Security Policy (it needs a fresh nonce each request); `next.config.ts`
 * sets the static, nonce-free headers for every response — including static assets and API
 * routes the proxy matcher skips. Keeping both callers on this module keeps the enforced policy
 * and the tests that assert it from drifting apart.
 *
 * Threat model and intentional relaxations are documented in
 * `docs/adr/0003-content-security-policy.md`.
 */

/** A header as the Next.js `headers()` config expects it. */
export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

/**
 * `Permissions-Policy` denies every powerful feature the app never uses. An empty allowlist
 * `()` disables the feature for this origin and all frames, so a compromised or injected
 * subresource cannot silently reach the camera, mic, location, payment, or ad-topics APIs.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * `Strict-Transport-Security`: two years, subdomains, preload-eligible. Emitted only in
 * production so local `http://localhost` development is never pinned to HTTPS.
 */
export const STRICT_TRANSPORT_SECURITY =
  "max-age=63072000; includeSubDomains; preload";

/**
 * The static security headers applied to every response. These carry no nonce, so they are set
 * once in `next.config.ts` and cover static assets and API routes as well as documents.
 * `Strict-Transport-Security` is added on top of this set in production only.
 */
export const BASELINE_SECURITY_HEADERS: readonly HeaderEntry[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
];

/**
 * A restrictive, nonce-free policy for JSON API routes, which never return executable markup.
 * `default-src 'none'` denies everything by default; the route only ever emits data.
 */
export const API_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Options controlling the document Content Security Policy. */
export interface ContentSecurityPolicyOptions {
  /** The per-request nonce that authorizes Next.js's own inline and bundled scripts. */
  readonly nonce: string;
  /** Development loosens script/connect rules for React refresh and HMR. Defaults to false. */
  readonly isDev?: boolean;
}

/**
 * Builds the document Content Security Policy.
 *
 * `script-src` trusts only the per-request nonce plus `'strict-dynamic'`, so Next.js's runtime
 * loads its hashed bundles while user-authored labels, links, and imported diagram text can
 * never introduce an executing script — the acceptance criterion that no policy relies on
 * unrestricted script execution for user content. `'unsafe-inline'` is intentionally scoped to
 * `style-src` only: React renders animation transforms as inline `style` attributes, which
 * cannot execute script, so this is a deliberate, low-risk relaxation (see the ADR).
 *
 * In development, `'unsafe-eval'` is added because React and the Next.js error overlay use
 * `eval`, and `ws:`/`wss:` are added to `connect-src` for the HMR socket. Neither is present in
 * production.
 */
export function buildContentSecurityPolicy({
  nonce,
  isDev = false,
}: ContentSecurityPolicyOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  const connectSrc = ["'self'", ...(isDev ? ["ws:", "wss:"] : [])].join(" ");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ");
}

/**
 * Generates a fresh, unpredictable nonce. Uses the Web Crypto global available in the Next.js
 * proxy runtime; 16 random bytes, base64-encoded, matches the `'nonce-…'` grammar.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
