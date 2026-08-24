import {
  createGraphSnapshot,
  entityId,
  type EdgeEntity,
  type GraphEntity,
  type GroupEntity,
  type NodeEntity,
} from "@/domain/graph";
import type {
  DiagramImportInput,
  DiagramImportResult,
  ImporterCapabilities,
} from "@/domain/import/contract";
import { parsePlantuml } from "@/domain/plantuml/parser";
import type { ParsedRelation } from "@/domain/plantuml/types";

/** Identifier of this importer, recorded in {@link GraphSnapshot} provenance. */
export const PLANTUML_IMPORTER = "plantuml";
/** Version of this importer, bumped when its output shape changes. */
export const PLANTUML_IMPORTER_VERSION = "0.1.0";
/** The `diagramType` written onto snapshots this importer produces. */
export const PLANTUML_DIAGRAM_TYPE = "plantuml";

export const PLANTUML_CAPABILITIES: ImporterCapabilities = {
  importer: PLANTUML_IMPORTER,
  importerVersion: PLANTUML_IMPORTER_VERSION,
  label: "PlantUML",
  diagramType: PLANTUML_DIAGRAM_TYPE,
  grammar: "plantuml",
  summary:
    "Elements, relations, and package/namespace/rectangle containers from a `@startuml` document, normalized into nodes, edges, and nested groups.",
  features: [
    {
      name: "Elements",
      support: "full",
      detail:
        "class/interface/enum/component/actor/participant/node/database and `[bracket]` components.",
    },
    {
      name: "Relations",
      support: "full",
      detail:
        "Association, dependency, extension, composition, and aggregation, with labels.",
    },
    {
      name: "Containers",
      support: "full",
      detail:
        "package/namespace/rectangle/node/folder/frame → nested drill-down groups.",
    },
    {
      name: "Class members",
      support: "none",
      detail:
        "Fields and methods inside a class body are skipped; the class still imports.",
    },
    {
      name: "Styling & directives",
      support: "none",
      detail: "skinparam/hide/note/!preprocessor are reported and ignored.",
    },
  ],
};

/**
 * Derives the stable semantic key for a relation. The base is `source->target`; identical pairs
 * are disambiguated by appending `~2`, `~3`, … in source order so re-importing unchanged source
 * always reproduces the same keys.
 */
function relationKey(
  relation: ParsedRelation,
  seen: Map<string, number>,
): string {
  const base = `${relation.source}->${relation.target}`;
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}~${count}`;
}

/**
 * Imports a PlantUML diagram into a normalized {@link GraphSnapshot} through the same graph
 * boundary as the Mermaid importers: elements become {@link NodeEntity}s (their source id/alias
 * is the stable key; the declaring keyword rides along as a `type` attribute), `package`/
 * `namespace`/`rectangle`/`node`/… containers become {@link GroupEntity}s so they feed the
 * drill-down explorer as nested groups, and relations become {@link EdgeEntity}s keyed
 * `source->target` in source order. Re-importing unchanged source reconnects every entity by key,
 * so a downstream comparison reports no change. The original source is stored verbatim, layout is
 * left to a separate deterministic pass, and every unsupported or unsafe construct surfaces as a
 * diagnostic rather than a thrown error. A fatal diagnostic (missing `@startuml`/empty source)
 * yields `snapshot: null`.
 */
export function importPlantuml(input: DiagramImportInput): DiagramImportResult {
  const parsed = parsePlantuml(input.text);
  const hasError = parsed.diagnostics.some((d) => d.severity === "error");

  if (parsed.fatal) {
    return {
      ok: false,
      snapshot: null,
      diagnostics: parsed.diagnostics,
      capabilities: PLANTUML_CAPABILITIES,
    };
  }

  const nodeEntities: NodeEntity[] = parsed.elements.map((element) => {
    const attributes: Record<string, string> = {};
    if (element.type !== undefined) attributes.type = element.type;
    return {
      kind: "node",
      id: entityId(element.id),
      label: element.label,
      ...(element.groupId !== undefined
        ? { groupId: entityId(element.groupId) }
        : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    };
  });

  const groupEntities: GroupEntity[] = parsed.containers.map((container) => ({
    kind: "group",
    id: entityId(container.id),
    label: container.label,
    memberIds: container.memberIds.map((id) => entityId(id)),
  }));

  const seen = new Map<string, number>();
  const edgeEntities: EdgeEntity[] = parsed.relations.map((relation) => {
    const attributes: Record<string, string> = {};
    if (relation.line !== "solid") attributes.line = relation.line;
    if (relation.kind !== "association") attributes.relation = relation.kind;
    return {
      kind: "edge",
      id: entityId(relationKey(relation, seen)),
      source: entityId(relation.source),
      target: entityId(relation.target),
      ...(relation.label !== undefined ? { label: relation.label } : {}),
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
      diagramType: PLANTUML_DIAGRAM_TYPE,
      text: input.text,
      importer: {
        importer: PLANTUML_IMPORTER,
        importerVersion: PLANTUML_IMPORTER_VERSION,
        importedAt: input.importedAt,
      },
    },
    entities,
  });

  return {
    ok: !hasError,
    snapshot,
    diagnostics: parsed.diagnostics,
    capabilities: PLANTUML_CAPABILITIES,
  };
}
