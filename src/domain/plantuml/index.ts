import type { GraphSnapshot, LayoutHint } from "@/domain/graph";
import type { DiagramImporter } from "@/domain/import/contract";
import {
  importPlantuml,
  PLANTUML_CAPABILITIES,
} from "@/domain/plantuml/import";
import { layoutPlantuml } from "@/domain/plantuml/layout";

const HEADER_RE = /^@startuml\b/i;

/**
 * The first line of PlantUML source that carries a header, skipping blank lines and `'` comments.
 * Detection reads only the header, never the whole document, so it stays cheap and side-effect
 * free.
 */
function firstHeaderLine(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("'")) continue;
    return trimmed;
  }
  return undefined;
}

/** The PlantUML importer, wired to the shared {@link DiagramImporter} contract. */
export const plantumlImporter: DiagramImporter = {
  capabilities: PLANTUML_CAPABILITIES,
  detect(text: string): boolean {
    const header = firstHeaderLine(text);
    return header !== undefined && HEADER_RE.test(header);
  },
  import: importPlantuml,
  layout(snapshot: GraphSnapshot): Promise<readonly LayoutHint[]> {
    return layoutPlantuml(snapshot);
  },
};

export {
  type RelationLine,
  type RelationKind,
  type ParsedElement,
  type ParsedRelation,
  type ParsedContainer,
  type ParsedPlantuml,
} from "@/domain/plantuml/types";
export { parsePlantuml } from "@/domain/plantuml/parser";
export { layoutPlantuml } from "@/domain/plantuml/layout";
export {
  PLANTUML_IMPORTER,
  PLANTUML_IMPORTER_VERSION,
  PLANTUML_DIAGRAM_TYPE,
  PLANTUML_CAPABILITIES,
  importPlantuml,
} from "@/domain/plantuml/import";
export {
  ACCEPTANCE_PLANTUML,
  RICH_PLANTUML,
  HOSTILE_PLANTUML,
} from "@/domain/plantuml/fixtures";
