import {
  createGraphSnapshot,
  entityId,
  type EdgeEntity,
  type GraphEntity,
  type NodeEntity,
} from "@/domain/graph";
import type {
  DiagramImportInput,
  DiagramImportResult,
  ImporterCapabilities,
} from "@/domain/import/contract";
import { parseSequence } from "@/domain/mermaid/sequence/parser";
import type { ParsedMessage } from "@/domain/mermaid/sequence/types";

/** Identifier of this importer, recorded in {@link GraphSnapshot} provenance. */
export const SEQUENCE_IMPORTER = "mermaid-sequence";
/** Version of this importer, bumped when its output shape changes. */
export const SEQUENCE_IMPORTER_VERSION = "0.1.0";
/** The `diagramType` written onto snapshots this importer produces. */
export const SEQUENCE_DIAGRAM_TYPE = "sequenceDiagram";

export const SEQUENCE_CAPABILITIES: ImporterCapabilities = {
  importer: SEQUENCE_IMPORTER,
  importerVersion: SEQUENCE_IMPORTER_VERSION,
  label: "Mermaid Sequence Diagram",
  diagramType: SEQUENCE_DIAGRAM_TYPE,
  grammar: "mermaid",
  summary:
    "Participants and the ordered messages between them, normalized into nodes and directed edges.",
  features: [
    { name: "Participants & actors", support: "full" },
    {
      name: "Messages",
      support: "full",
      detail: "Sync/async, solid/dotted, and labeled messages in source order.",
    },
    {
      name: "Activations",
      support: "none",
      detail:
        "Activation bars are reported and ignored; messages still import.",
    },
    {
      name: "Notes",
      support: "none",
      detail: "Notes are reported and not imported as entities.",
    },
    {
      name: "Control blocks",
      support: "partial",
      detail: "loop/alt/opt/par are flattened; their inner messages import.",
    },
  ],
};

/**
 * Derives the stable semantic key for a message. The base is `source->target`; identical pairs
 * are disambiguated by appending `~2`, `~3`, … in source order so re-importing unchanged source
 * always reproduces the same keys.
 */
function messageKey(message: ParsedMessage, seen: Map<string, number>): string {
  const base = `${message.source}->${message.target}`;
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}~${count}`;
}

/**
 * Imports a Mermaid sequence diagram into a normalized {@link GraphSnapshot} through the same
 * graph boundary as the flowchart importer: participants become {@link NodeEntity}s (their
 * source id is the stable key; actors carry a `role` attribute), and messages become
 * {@link EdgeEntity}s keyed `source->target` in source order. Re-importing unchanged source
 * reconnects every entity by key, so a downstream comparison reports no change. The original
 * source is stored verbatim, layout is left to a separate deterministic pass, and every
 * unsupported or unsafe construct surfaces as a diagnostic rather than a thrown error. A fatal
 * diagnostic (bad header / empty source) yields `snapshot: null`.
 */
export function importMermaidSequence(
  input: DiagramImportInput,
): DiagramImportResult {
  const parsed = parseSequence(input.text);
  const hasError = parsed.diagnostics.some((d) => d.severity === "error");

  if (parsed.fatal) {
    return {
      ok: false,
      snapshot: null,
      diagnostics: parsed.diagnostics,
      capabilities: SEQUENCE_CAPABILITIES,
    };
  }

  const nodeEntities: NodeEntity[] = parsed.participants.map((participant) => {
    const attributes: Record<string, string> = {};
    if (participant.role !== "participant") attributes.role = participant.role;
    return {
      kind: "node",
      id: entityId(participant.id),
      label: participant.label,
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
  });

  const seen = new Map<string, number>();
  const edgeEntities: EdgeEntity[] = parsed.messages.map((message) => {
    const attributes: Record<string, string> = {};
    if (message.line !== "solid") attributes.line = message.line;
    if (message.arrow !== "normal") attributes.arrow = message.arrow;
    return {
      kind: "edge",
      id: entityId(messageKey(message, seen)),
      source: entityId(message.source),
      target: entityId(message.target),
      ...(message.label !== undefined ? { label: message.label } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
  });

  const entities: GraphEntity[] = [...nodeEntities, ...edgeEntities];

  const snapshot = createGraphSnapshot({
    id: input.snapshotId,
    source: {
      diagramType: SEQUENCE_DIAGRAM_TYPE,
      text: input.text,
      importer: {
        importer: SEQUENCE_IMPORTER,
        importerVersion: SEQUENCE_IMPORTER_VERSION,
        importedAt: input.importedAt,
      },
    },
    entities,
  });

  return {
    ok: !hasError,
    snapshot,
    diagnostics: parsed.diagnostics,
    capabilities: SEQUENCE_CAPABILITIES,
  };
}
