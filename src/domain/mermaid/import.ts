import {
  createGraphSnapshot,
  entityId,
  type EdgeEntity,
  type EntityId,
  type GraphEntity,
  type GroupEntity,
  type NodeEntity,
  type SnapshotId,
} from "@/domain/graph";
import { parseFlowchart, type ParsedEdge } from "@/domain/mermaid/parser";
import type { MermaidImportResult } from "@/domain/mermaid/types";

/** Identifier of this importer, recorded in {@link GraphSnapshot} provenance. */
export const MERMAID_IMPORTER = "mermaid-flowchart";
/** Version of this importer, bumped when its output shape changes. */
export const MERMAID_IMPORTER_VERSION = "0.1.0";

export interface ImportMermaidInput {
  /** Raw Mermaid source, preserved byte-for-byte in the snapshot. */
  readonly text: string;
  /** Id to assign the produced snapshot. */
  readonly snapshotId: SnapshotId;
  /** ISO-8601 timestamp for the import, supplied by the caller for determinism. */
  readonly importedAt: string;
}

/**
 * Derives the stable semantic key for an edge. The base is `source->target`; identical pairs
 * are disambiguated by appending `~2`, `~3`, … in source order so re-importing unchanged
 * source always reproduces the same keys.
 */
function edgeKey(edge: ParsedEdge, seen: Map<string, number>): string {
  const base = `${edge.source}->${edge.target}`;
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}~${count}`;
}

/**
 * Imports a Mermaid flowchart into a normalized {@link GraphSnapshot}. Source identities
 * become stable semantic {@link EntityId}s (node/group ids verbatim, edges as
 * `source->target`), so a re-import of unchanged source reconnects every entity by key and a
 * downstream {@link compareSnapshots} reports no change. The original source is stored
 * unchanged, layout is left to a separate deterministic pass, and every unsupported or
 * unsafe construct surfaces as a diagnostic rather than a thrown error. A fatal diagnostic
 * (bad header / empty source) yields `snapshot: null`.
 */
export function importMermaidFlowchart(input: ImportMermaidInput): MermaidImportResult {
  const parsed = parseFlowchart(input.text);

  const hasError = parsed.diagnostics.some((d) => d.severity === "error");
  if (parsed.fatal) {
    return {
      ok: false,
      snapshot: null,
      diagnostics: parsed.diagnostics,
      direction: parsed.direction,
    };
  }

  const nodeEntities: NodeEntity[] = parsed.nodes.map((node) => {
    const attributes: Record<string, string> = {};
    if (node.shape !== "rectangle") attributes.shape = node.shape;
    return {
      kind: "node",
      id: entityId(node.id),
      label: node.label,
      ...(node.groupId !== undefined ? { groupId: entityId(node.groupId) } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
  });

  const groupEntities: GroupEntity[] = parsed.groups.map((group) => ({
    kind: "group",
    id: entityId(group.id),
    label: group.label,
    memberIds: group.memberIds.map((id) => entityId(id)),
  }));

  const seen = new Map<string, number>();
  const edgeEntities: EdgeEntity[] = parsed.edges.map((edge) => {
    const attributes: Record<string, string> = {};
    if (edge.line !== "solid") attributes.line = edge.line;
    if (edge.arrow !== "normal") attributes.arrow = edge.arrow;
    return {
      kind: "edge",
      id: entityId(edgeKey(edge, seen)),
      source: entityId(edge.source),
      target: entityId(edge.target),
      ...(edge.label !== undefined ? { label: edge.label } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
  });

  const entities: GraphEntity[] = [...nodeEntities, ...groupEntities, ...edgeEntities];

  const snapshot = createGraphSnapshot({
    id: input.snapshotId,
    source: {
      diagramType: "flowchart",
      text: input.text,
      importer: {
        importer: MERMAID_IMPORTER,
        importerVersion: MERMAID_IMPORTER_VERSION,
        importedAt: input.importedAt,
      },
    },
    entities,
  });

  return {
    ok: !hasError,
    snapshot,
    diagnostics: parsed.diagnostics,
    direction: parsed.direction,
  };
}

/**
 * Convenience for "re-import reconnects unchanged entities by semantic key": returns the set
 * of {@link EntityId}s a fresh import shares with a previous one. Because keys are derived
 * deterministically from source identity, this is exactly the set of entities that survived
 * the edit — the basis on which layout overrides and story references are preserved.
 */
export function reconnectedEntityIds(
  previous: readonly GraphEntity[],
  next: readonly GraphEntity[],
): readonly EntityId[] {
  const previousIds = new Set(previous.map((entity) => entity.id));
  return next.map((entity) => entity.id).filter((id) => previousIds.has(id));
}
