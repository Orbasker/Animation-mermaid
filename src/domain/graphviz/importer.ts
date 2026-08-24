import type { GraphSnapshot, LayoutHint } from "@/domain/graph";
import type { DiagramImporter } from "@/domain/import/contract";
import { GRAPHVIZ_CAPABILITIES } from "@/domain/graphviz/capabilities";
import { importGraphvizDot } from "@/domain/graphviz/import";
import { layoutGraphviz } from "@/domain/graphviz/layout";
import { parseGraphviz } from "@/domain/graphviz/parser";

const HEADER_RE = /^(?:strict\s+)?(digraph|graph)\b/;
const MERMAID_GRAPH_HEADER_RE = /^(?:strict\s+)?graph(?:\s+[A-Za-z]{2})?\s*$/;

/**
 * Returns the first non-blank, non-comment line of DOT source. Unlike the Mermaid header reader
 * this strips DOT's own comment forms (`//`, block comments, and `#` preprocessor lines) so a
 * commented preamble never hides the `digraph`/`graph` header.
 */
function firstDotLine(text: string): string | undefined {
  let inBlockComment = false;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    // Drop any inline block comment(s) opened and closed on this line.
    line = line.replace(/\/\*[\s\S]*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      inBlockComment = true;
      line = line.slice(0, open);
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return undefined;
}

/**
 * The Graphviz DOT importer, wired to the shared {@link DiagramImporter} contract. Detection
 * recognizes `digraph` unconditionally and distinguishes DOT's `graph … { … }` from Mermaid's
 * `graph TD` (a bare header with an optional two-letter direction) so the two grammars never
 * claim each other's source.
 */
export const graphvizImporter: DiagramImporter = {
  capabilities: GRAPHVIZ_CAPABILITIES,
  detect(text: string): boolean {
    const header = firstDotLine(text);
    if (header === undefined) return false;
    const match = HEADER_RE.exec(header);
    if (!match) return false;
    if (match[1] === "digraph") return true;
    // Undirected `graph`: it's DOT unless it looks like a Mermaid flowchart header.
    return !MERMAID_GRAPH_HEADER_RE.test(header);
  },
  import(input) {
    const result = importGraphvizDot(input);
    return {
      ok: result.ok,
      snapshot: result.snapshot,
      diagnostics: result.diagnostics,
      capabilities: GRAPHVIZ_CAPABILITIES,
    };
  },
  layout(snapshot: GraphSnapshot): Promise<readonly LayoutHint[]> {
    const { direction } = parseGraphviz(snapshot.source.text);
    return layoutGraphviz(snapshot, direction);
  },
};
