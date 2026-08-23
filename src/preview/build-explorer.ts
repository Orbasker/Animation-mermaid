import {
  EXPLORER_RUNTIME_SOURCE,
  EXPLORER_STYLES,
} from "@/preview/explorer-runtime";
import type { StructureDiagram } from "@/preview/structure-model";

/**
 * Escapes a string for safe interpolation into HTML text or a double-quoted attribute, so a
 * hostile diagram name or label is rendered as inert text and can never open a tag.
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
 * Serializes the diagram models for a `<script type="application/json">` block. `<` becomes its
 * JSON unicode escape so no substring of a label — `</script>` included — can terminate the
 * element, and U+2028 / U+2029 are escaped because they are valid in JSON but not in JS strings.
 */
export function serializeDiagrams(
  diagrams: readonly StructureDiagram[],
): string {
  return JSON.stringify({ diagrams })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface BuildExplorerHtmlInput {
  readonly diagrams: readonly StructureDiagram[];
  /** The inlined ELK bundle source (read from `elkjs/lib/elk.bundled.js` by the caller). */
  readonly elkSource: string;
  /**
   * The bundled browser build of `@/preview/browser-entry`, which exposes the app's real
   * Mermaid importer on `window.__STRUCTURE__`. Inlining it lets the in-page editor re-parse
   * edited source with the same code path as the generator. Omit to ship a read-only explorer.
   */
  readonly parserSource?: string;
  /** Document title and header heading. */
  readonly title?: string;
}

/**
 * Assembles a single self-contained HTML document that renders one or more Mermaid structure
 * diagrams as interactive, collapsible trees. The ELK layout bundle, the explorer styles, the
 * runtime, and the diagram models are all inlined — the document references nothing external, so
 * it opens offline in a clean browser profile. Each diagram becomes a tab; each subgraph can be
 * collapsed to a single box and expanded again, with the layout recomputed on every toggle.
 */
export function buildStructureExplorerHtml(
  input: BuildExplorerHtmlInput,
): string {
  const title = input.title ?? "Mermaid structure explorer";
  const documentTitle = escapeHtml(title);
  const embedded = serializeDiagrams(input.diagrams);
  const editButton = input.parserSource
    ? `\n<button type="button" id="edit">Edit source</button>`
    : "";
  const parserTag = input.parserSource
    ? `\n<script>${input.parserSource}</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="animation-mermaid-structure-explorer" />
<title>${documentTitle}</title>
<style>${EXPLORER_STYLES}</style>
</head>
<body>
<header>
<h1>${documentTitle}</h1>
<nav class="tabs" id="tabs" role="tablist" aria-label="Diagrams"></nav>
<div class="toolbar">
<button type="button" id="expand-all">Expand all</button>
<button type="button" id="collapse-all">Collapse all</button>
<button type="button" id="fit">Fit</button>${editButton}
</div>
</header>
<main id="app">
<div id="stage" style="position:absolute;inset:0"></div>
<aside id="editor" hidden>
<div class="editor-head"><strong>Mermaid source</strong><span id="editor-status"></span></div>
<textarea id="editor-text" spellcheck="false"></textarea>
<div class="editor-actions">
<button type="button" id="editor-apply">Apply</button>
<button type="button" id="editor-close">Close</button>
</div>
</aside>
</main>
<script>${input.elkSource}</script>${parserTag}
<script type="application/json" id="explorer-data">${embedded}</script>
<script>
window.__EXPLORER__ = JSON.parse(document.getElementById("explorer-data").textContent);
</script>
<script>${EXPLORER_RUNTIME_SOURCE}</script>
</body>
</html>
`;
}
