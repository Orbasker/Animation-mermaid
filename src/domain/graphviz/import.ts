import {
  createGraphSnapshot,
  entityId,
  type EdgeEntity,
  type GraphEntity,
  type GroupEntity,
  type NodeEntity,
} from "@/domain/graph";
import type { DiagramImportInput } from "@/domain/import/contract";
import { graphvizEdgeKey, parseGraphviz } from "@/domain/graphviz/parser";
import type { GraphvizImportResult } from "@/domain/graphviz/types";

/** Identifier of this importer, recorded in {@link GraphSnapshot} provenance. */
export const GRAPHVIZ_IMPORTER = "graphviz-dot";
/** Version of this importer, bumped when its output shape changes. */
export const GRAPHVIZ_IMPORTER_VERSION = "0.1.0";
/** The `diagramType` written onto snapshots this importer produces. */
export const GRAPHVIZ_DIAGRAM_TYPE = "graphviz";

/**
 * Imports Graphviz DOT into a normalized {@link GraphSnapshot} through the same graph boundary as
 * the Mermaid importers: DOT node ids become stable semantic {@link EntityId}s, `cluster*`
 * subgraphs become nested {@link GroupEntity} containers (a node's `groupId` is its innermost
 * cluster; a cluster's `memberIds` list its direct nodes and nested clusters, for drill-down), and
 * edges are keyed `source->target` in source order. Re-importing unchanged source reconnects every
 * entity by key, so a downstream comparison reports no change. The original source is stored
 * verbatim, layout is left to a separate deterministic pass, and every unsupported or unsafe
 * construct surfaces as a diagnostic rather than a thrown error. A fatal diagnostic (bad header /
 * empty source) yields `snapshot: null`.
 */
export function importGraphvizDot(
  input: DiagramImportInput,
): GraphvizImportResult {
  const parsed = parseGraphviz(input.text);
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
    if (node.shape !== undefined) attributes.shape = node.shape;
    return {
      kind: "node",
      id: entityId(node.id),
      label: node.label,
      ...(node.groupId !== undefined
        ? { groupId: entityId(node.groupId) }
        : {}),
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
    return {
      kind: "edge",
      id: entityId(graphvizEdgeKey(edge, seen)),
      source: entityId(edge.source),
      target: entityId(edge.target),
      ...(edge.label !== undefined && edge.label.length > 0
        ? { label: edge.label }
        : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
  });

  const entities: GraphEntity[] = [
    ...nodeEntities,
    ...groupEntities,
    ...edgeEntities,
  ];

  const snapshot = createGraphSnapshot({
    id: input.snapshotId,
    source: {
      diagramType: GRAPHVIZ_DIAGRAM_TYPE,
      text: input.text,
      importer: {
        importer: GRAPHVIZ_IMPORTER,
        importerVersion: GRAPHVIZ_IMPORTER_VERSION,
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
