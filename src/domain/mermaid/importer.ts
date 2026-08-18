import type { GraphSnapshot, LayoutHint } from "@/domain/graph";
import type { DiagramImporter } from "@/domain/import/contract";
import { firstSignificantLine } from "@/domain/import/source";
import { FLOWCHART_CAPABILITIES } from "@/domain/mermaid/capabilities";
import { importMermaidFlowchart } from "@/domain/mermaid/import";
import { layoutFlowchart } from "@/domain/mermaid/layout";
import { parseFlowchart } from "@/domain/mermaid/parser";

const HEADER_RE = /^(?:flowchart|graph)\b/;

/** The Mermaid flowchart importer, wired to the shared {@link DiagramImporter} contract. */
export const flowchartImporter: DiagramImporter = {
  capabilities: FLOWCHART_CAPABILITIES,
  detect(text: string): boolean {
    const header = firstSignificantLine(text);
    return header !== undefined && HEADER_RE.test(header);
  },
  import(input) {
    const result = importMermaidFlowchart(input);
    return {
      ok: result.ok,
      snapshot: result.snapshot,
      diagnostics: result.diagnostics,
      capabilities: FLOWCHART_CAPABILITIES,
    };
  },
  layout(snapshot: GraphSnapshot): Promise<readonly LayoutHint[]> {
    const { direction } = parseFlowchart(snapshot.source.text);
    return layoutFlowchart(snapshot, { direction });
  },
};
