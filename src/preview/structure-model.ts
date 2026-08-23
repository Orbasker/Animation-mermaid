import { snapshotId, type GraphEntity } from "@/domain/graph";
import { importMermaidFlowchart } from "@/domain/mermaid/import";
import type {
  Direction,
  EdgeArrow,
  EdgeLineStyle,
  NodeShape,
} from "@/domain/mermaid/types";

/** A single node in a structure diagram, flattened for the browser renderer. */
export interface StructureNode {
  readonly id: string;
  readonly label: string;
  readonly shape: NodeShape;
  /** Enclosing group id, when the node lives inside a subgraph. */
  readonly parent?: string;
}

/** A subgraph. Groups nest via {@link StructureGroup.parent} and can be collapsed. */
export interface StructureGroup {
  readonly id: string;
  readonly label: string;
  /** Enclosing group id, when this subgraph is nested inside another. */
  readonly parent?: string;
}

/** A directed relationship, carrying enough style to reproduce the connector. */
export interface StructureEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly line: EdgeLineStyle;
  readonly arrow: EdgeArrow;
}

/**
 * A renderer-ready description of one Mermaid flowchart: its direction, its nodes and nested
 * groups (each carrying only its parent, so the browser can rebuild the hierarchy for any
 * collapse state), and its edges. This is the unit embedded per tab in the exported explorer.
 */
export interface StructureDiagram {
  readonly id: string;
  readonly name: string;
  readonly direction: Direction;
  readonly nodes: readonly StructureNode[];
  readonly groups: readonly StructureGroup[];
  readonly edges: readonly StructureEdge[];
  /** Non-fatal problems surfaced by the importer, shown alongside the diagram. */
  readonly warnings: readonly string[];
  /** The Mermaid source this model was built from, so the in-page editor can prefill it. */
  readonly source: string;
}

export interface BuildStructureDiagramInput {
  /** Stable id for the diagram, used as the tab key. Derive from the file name. */
  readonly id: string;
  /** Human-facing tab label. */
  readonly name: string;
  /** Raw Mermaid flowchart source. */
  readonly source: string;
}

/** Thrown when a source cannot be imported as a flowchart at all (fatal diagnostic). */
export class StructureDiagramError extends Error {
  constructor(
    readonly diagramName: string,
    readonly reason: string,
  ) {
    super(`Cannot build structure diagram "${diagramName}": ${reason}`);
    this.name = "StructureDiagramError";
  }
}

function shapeOf(attributes: Readonly<Record<string, string>> | undefined) {
  return (attributes?.shape as NodeShape | undefined) ?? "rectangle";
}

function lineOf(attributes: Readonly<Record<string, string>> | undefined) {
  return (attributes?.line as EdgeLineStyle | undefined) ?? "solid";
}

function arrowOf(attributes: Readonly<Record<string, string>> | undefined) {
  return (attributes?.arrow as EdgeArrow | undefined) ?? "normal";
}

/**
 * Imports one Mermaid flowchart and flattens it into a {@link StructureDiagram}. Group nesting
 * is recovered by mapping each subgraph to the subgraph that lists it as a member, so both node
 * membership (`groupId`) and group-in-group nesting survive into a single parent-per-entity
 * shape the browser layout can consume for any collapse state. Non-fatal importer diagnostics
 * become {@link StructureDiagram.warnings}; a fatal one throws {@link StructureDiagramError}.
 */
export function buildStructureDiagram(
  input: BuildStructureDiagramInput,
): StructureDiagram {
  const result = importMermaidFlowchart({
    text: input.source,
    snapshotId: snapshotId(input.id),
    importedAt: "1970-01-01T00:00:00.000Z",
  });

  if (!result.snapshot) {
    const fatal = result.diagnostics.find((d) => d.severity === "error");
    throw new StructureDiagramError(
      input.name,
      fatal?.message ?? "no flowchart was produced",
    );
  }

  const entities = result.snapshot.entities;

  const groupParent = new Map<string, string>();
  for (const entity of entities) {
    if (entity.kind !== "group") continue;
    for (const memberId of entity.memberIds) {
      const member = entities.find((e) => e.id === memberId);
      if (member?.kind === "group") {
        groupParent.set(member.id as string, entity.id as string);
      }
    }
  }

  const nodes: StructureNode[] = [];
  const groups: StructureGroup[] = [];
  for (const entity of entities as readonly GraphEntity[]) {
    if (entity.kind === "node") {
      nodes.push({
        id: entity.id as string,
        label: entity.label,
        shape: shapeOf(entity.attributes),
        ...(entity.groupId ? { parent: entity.groupId as string } : {}),
      });
    } else if (entity.kind === "group") {
      const parent = groupParent.get(entity.id as string);
      groups.push({
        id: entity.id as string,
        label: entity.label,
        ...(parent ? { parent } : {}),
      });
    }
  }

  const edges: StructureEdge[] = entities
    .filter((e) => e.kind === "edge")
    .map((edge) => ({
      id: edge.id as string,
      source: edge.source as string,
      target: edge.target as string,
      ...(edge.label !== undefined ? { label: edge.label } : {}),
      line: lineOf(edge.attributes),
      arrow: arrowOf(edge.attributes),
    }));

  return {
    id: input.id,
    name: input.name,
    direction: result.direction,
    nodes,
    groups,
    edges,
    warnings: result.diagnostics
      .filter((d) => d.severity !== "error")
      .map((d) => `Line ${d.line}: ${d.message}`),
    source: input.source,
  };
}
