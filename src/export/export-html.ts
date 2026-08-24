import type { ExportPayload } from "@/export/export-payload";
import { PLAYER_SCRIPT_SOURCE, PLAYER_STYLES } from "@/export/player-runtime";

/**
 * Base64 SHA-256 hashes of the exact inline script and style the export embeds. They lock the
 * standalone document's Content Security Policy to this precise runtime: the browser executes
 * the player only when the inline `<script>`/`<style>` match, and no script injected through a
 * label, title, or link can run. `export-html.test.ts` recomputes both from the source and
 * fails if the runtime changes without these being regenerated.
 */
export const PLAYER_SCRIPT_CSP_HASH =
  "sha256-aJ6UhkaZCXvLncQ7JKPsBsBOYWgoaqmibqHe0L5Ea7w=";
export const PLAYER_STYLE_CSP_HASH =
  "sha256-aetr/H+X/jcve7wpQZsaT286AGa8x1rtwU8BFz6oMgY=";

/**
 * The Content Security Policy carried in the exported document's `<meta>` tag. `default-src
 * 'none'` denies everything by default; only the two hashed inline assets are admitted, the
 * data island is a non-executable `application/json` block, and the player builds its diagram
 * from DOM APIs (never `innerHTML`, `fetch`, or remote assets). Nothing user-authored can widen
 * this policy, satisfying the "exported content cannot expand the policy" requirement.
 */
export const EXPORT_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src '${PLAYER_SCRIPT_CSP_HASH}'`,
  `style-src '${PLAYER_STYLE_CSP_HASH}'`,
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * Escapes a string for safe interpolation into HTML text or a double-quoted attribute.
 * Everything that originates in project data (labels, titles, attribution) passes through
 * here before it reaches the markup, so a hostile label or `javascript:` link is rendered as
 * inert text and can never open a tag or an attribute.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serializes the payload for embedding inside a `<script type="application/json">` block.
 * `<` is escaped to its JSON unicode form so no substring of any label — `</script>`
 * included — can terminate the script element and break out into executable markup. U+2028 /
 * U+2029 are escaped too, since they are valid in JSON strings but not in JS string literals.
 */
export function serializeEmbeddedPayload(payload: ExportPayload): string {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderStaticFallback(payload: ExportPayload): string {
  const scenes = payload.outline
    .map((scene) => {
      const descriptions = scene.descriptions
        .map((text) => `        <li>${escapeHtml(text)}</li>`)
        .join("\n");
      return [
        `    <li>`,
        `      <strong>${escapeHtml(scene.title)}</strong>`,
        descriptions ? `      <ul>\n${descriptions}\n      </ul>` : "",
        `    </li>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return [
    `<section class="staticFallback">`,
    `  <h2>${escapeHtml(payload.story.title)}</h2>`,
    `  <p>${escapeHtml(payload.meta.projectName)} · ${escapeHtml(
      payload.meta.diagramType,
    )}</p>`,
    `  <p>This design review animates when opened with JavaScript enabled. The scenes are:</p>`,
    `  <ol>`,
    scenes,
    `  </ol>`,
    `</section>`,
  ].join("\n");
}

/**
 * Assembles a single, self-contained HTML document that plays one exported design-review
 * story with no editor, account, or network access. The document embeds the sanitized
 * payload, the player styles, and the player runtime inline — it references nothing external,
 * so it opens offline in a clean browser profile. A `<noscript>` block carries the full scene
 * outline as static text, satisfying the no-JavaScript fallback.
 */
export function buildExportHtml(payload: ExportPayload): string {
  const documentTitle = escapeHtml(
    `${payload.story.title} — ${payload.meta.projectName}`,
  );
  const embedded = serializeEmbeddedPayload(payload);
  const staticFallback = renderStaticFallback(payload);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CONTENT_SECURITY_POLICY}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="animation-mermaid-export ${escapeHtml(
    payload.meta.formatVersion,
  )}" />
<title>${documentTitle}</title>
<style>${PLAYER_STYLES}</style>
</head>
<body>
<main id="app">
${staticFallback}
</main>
<noscript>
${staticFallback}
</noscript>
<script type="application/json" id="story-data">${embedded}</script>
<script>${PLAYER_SCRIPT_SOURCE}</script>
</body>
</html>
`;
}
