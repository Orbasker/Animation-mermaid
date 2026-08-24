# ADR 0003: Content Security Policy and security headers

## Status

Accepted

## What Changed

Every document response carries a nonce-based Content Security Policy and a set of static
security headers. The policy and headers have one source of truth, `src/lib/security-headers.ts`,
consumed by two callers:

- `src/proxy.ts` generates a fresh per-request nonce, builds the document CSP, and sets it on the
  response together with an `x-nonce` request header. Next.js reads the `'nonce-…'` from the CSP
  during server rendering and stamps it onto its own inline and bundled scripts. The root layout
  is `force-dynamic` so this happens on every request rather than at build time.
- `next.config.ts` sets the static, nonce-free headers for _all_ responses — including the static
  assets and API routes the proxy matcher skips — and adds a restrictive `default-src 'none'` CSP
  to JSON API routes.

The enforced document policy is:

```
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self';
connect-src 'self';           /* + ws: wss: in development for HMR */
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;    /* production only */
```

Static headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `X-DNS-Prefetch-Control: off`,
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, a
locked-down `Permissions-Policy`, and (production only) `Strict-Transport-Security` for two years
with `includeSubDomains; preload`.

Exported standalone HTML carries its own hash-locked policy in a `<meta http-equiv>` tag:
`default-src 'none'` with SHA-256 hashes for the one inline `<script>` and `<style>` it ships.
The embedded payload is a non-executable `application/json` island and the player builds its
diagram entirely from DOM APIs, so no user-authored label, title, or link can widen the policy.

## Why

The app renders user-authored Mermaid content, calls hosted AI services, and exports standalone
HTML — all inputs that must never become an XSS or clickjacking vector. A nonce with
`'strict-dynamic'` admits Next.js's own scripts while making it impossible for injected markup to
execute, which is the acceptance criterion that no policy relies on unrestricted script execution
for user content. Existing escaping in `export-html.ts` already renders hostile labels inert; the
CSP is defense in depth behind it.

## Intentional Relaxations

- **`style-src 'unsafe-inline'`.** React renders animation transforms as inline `style`
  attributes, and CSP nonces/hashes cannot cover per-element style attributes. Inline styles
  cannot execute script, so this is a low-risk relaxation; the security-critical guard is on
  `script-src`, which stays nonce-locked. The exported document avoids even this — its player sets
  styles through the CSSOM (`element.style.x = …`, not governed by CSP), so its `style-src` is a
  single hash with no `'unsafe-inline'`.
- **`img-src` / `worker-src` allow `blob:`** for canvas/worker-backed rendering, and `img-src`
  allows `data:` for inline SVG data URIs. Neither can carry executable script.
- **Development only:** `'unsafe-eval'` in `script-src` (React refresh and the error overlay use
  `eval`) and `ws:`/`wss:` in `connect-src` (HMR socket). Neither is present in production.

## Intentional Omissions

- **`Cross-Origin-Embedder-Policy` (COEP) is not set.** `require-corp` would demand a CORP header
  on every subresource (including worker and image blobs) and risks breaking rendering for no
  concrete threat this app faces; it can be revisited if cross-origin isolation is ever needed.

## Threat Assumptions

- The app is served over HTTPS in production (HSTS is emitted only there).
- Telemetry and AI calls are same-origin (`connect-src 'self'`). Vercel Speed Insights loads and
  reports over the same origin and is injected at runtime by already-trusted, nonce-admitted code,
  which `'strict-dynamic'` permits.
- Adding a new external script, style, connect, or frame origin requires an explicit change to
  `src/lib/security-headers.ts` and the accompanying tests, which fail when a required directive is
  removed or weakened.
