import type {
  DiagramImporter,
  DiagramImportInput,
  DiagramImportResult,
  ImporterCapabilities,
} from "@/domain/import/contract";
import { firstSignificantLine } from "@/domain/import/source";
import { flowchartImporter } from "@/domain/mermaid/importer";
import { sequenceImporter } from "@/domain/mermaid/sequence";

/**
 * Every registered importer, in detection priority order. Adding a diagram grammar is a matter
 * of implementing {@link DiagramImporter} and adding it here — nothing downstream of the graph
 * boundary (stories, the agent context) changes.
 */
export const IMPORTERS: readonly DiagramImporter[] = [
  flowchartImporter,
  sequenceImporter,
];

/** The capability report for every registered importer, for UI surfaces. */
export function listImporterCapabilities(): readonly ImporterCapabilities[] {
  return IMPORTERS.map((importer) => importer.capabilities);
}

/** Returns the first importer that recognizes the source, or `null` if none do. */
export function detectImporter(text: string): DiagramImporter | null {
  return IMPORTERS.find((importer) => importer.detect(text)) ?? null;
}

/** Looks an importer up by its stable id (as recorded in snapshot provenance). */
export function importerById(id: string): DiagramImporter | null {
  return (
    IMPORTERS.find((importer) => importer.capabilities.importer === id) ?? null
  );
}

/** Looks an importer up by the `diagramType` it writes onto a snapshot's source. */
export function importerByDiagramType(
  diagramType: string,
): DiagramImporter | null {
  return (
    IMPORTERS.find(
      (importer) => importer.capabilities.diagramType === diagramType,
    ) ?? null
  );
}

/**
 * Detects the grammar of the given source and imports it through the matching importer. When no
 * importer recognizes the source, returns a fatal `error` diagnostic and `snapshot: null` — an
 * unrecognized paste can never corrupt a project — with `capabilities: null` so callers can tell
 * "no importer ran" apart from "an importer ran and failed".
 */
export function importDiagram(input: DiagramImportInput): DiagramImportResult {
  const importer = detectImporter(input.text);
  if (!importer) {
    const header = firstSignificantLine(input.text);
    return {
      ok: false,
      snapshot: null,
      diagnostics: [
        {
          code: "unrecognized-diagram",
          severity: "error",
          message: header
            ? `No importer recognizes this diagram; expected a supported header, found "${header}".`
            : "No importer recognizes this diagram; the source is empty.",
          line: 1,
        },
      ],
      capabilities: null,
    };
  }
  return importer.import(input);
}
