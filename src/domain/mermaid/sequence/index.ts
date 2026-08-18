import type { GraphSnapshot, LayoutHint } from "@/domain/graph";
import type { DiagramImporter } from "@/domain/import/contract";
import { firstSignificantLine } from "@/domain/import/source";
import {
  importMermaidSequence,
  SEQUENCE_CAPABILITIES,
} from "@/domain/mermaid/sequence/import";
import { layoutSequence } from "@/domain/mermaid/sequence/layout";

const HEADER_RE = /^sequenceDiagram\b/;

/** The Mermaid sequence-diagram importer, wired to the shared {@link DiagramImporter} contract. */
export const sequenceImporter: DiagramImporter = {
  capabilities: SEQUENCE_CAPABILITIES,
  detect(text: string): boolean {
    const header = firstSignificantLine(text);
    return header !== undefined && HEADER_RE.test(header);
  },
  import: importMermaidSequence,
  layout(snapshot: GraphSnapshot): Promise<readonly LayoutHint[]> {
    return layoutSequence(snapshot);
  },
};

export {
  type ParticipantRole,
  type ParsedParticipant,
  type ParsedMessage,
  type ParsedSequence,
} from "@/domain/mermaid/sequence/types";
export { parseSequence } from "@/domain/mermaid/sequence/parser";
export {
  type SequenceLayoutOptions,
  layoutSequence,
} from "@/domain/mermaid/sequence/layout";
export {
  SEQUENCE_IMPORTER,
  SEQUENCE_IMPORTER_VERSION,
  SEQUENCE_DIAGRAM_TYPE,
  SEQUENCE_CAPABILITIES,
  importMermaidSequence,
} from "@/domain/mermaid/sequence/import";
export {
  ACCEPTANCE_SEQUENCE,
  RICH_SEQUENCE,
  HOSTILE_SEQUENCE,
} from "@/domain/mermaid/sequence/fixtures";
