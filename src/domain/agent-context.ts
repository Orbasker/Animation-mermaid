import { CURRENT_SCHEMA_VERSION, type Versioned } from "@/domain/schema-version";
import type { EntityId, GraphSnapshot, SnapshotId } from "@/domain/graph";
import type { Comparison, EntityChange } from "@/domain/comparison";

/**
 * A single entity as the agent sees it: semantic identity and meaning only. This is
 * deliberately a *different* type from {@link import("@/domain/graph").GraphEntity} so the
 * agent boundary can never accidentally leak layout hints, renderer handles, or attributes
 * the model has no business seeing.
 */
export type AgentEntity =
  | {
      readonly kind: "node";
      readonly id: EntityId;
      readonly label: string;
      readonly groupId?: EntityId;
    }
  | {
      readonly kind: "edge";
      readonly id: EntityId;
      readonly source: EntityId;
      readonly target: EntityId;
      readonly label?: string;
    }
  | {
      readonly kind: "group";
      readonly id: EntityId;
      readonly label: string;
      readonly memberIds: readonly EntityId[];
    };

/** The graph as the agent sees it: diagram kind plus semantic entities, no layout. */
export interface AgentGraphView {
  readonly snapshotId: SnapshotId;
  readonly diagramType: string;
  readonly entities: readonly AgentEntity[];
}

/**
 * The explicit, versioned boundary of everything handed to the AI workflow — and nothing
 * else. It is a pure, serializable, semantic-only projection: no React Flow nodes, no
 * Mermaid SVG, no animation-library timelines, and no layout coordinates. Everything the
 * agent may read passes through this shape, which is what keeps the agent decoupled from
 * how diagrams are rendered.
 */
export interface AgentContextPackage extends Versioned {
  /** Free-text description of what the workflow is being asked to do. */
  readonly intent: string;
  readonly graph: AgentGraphView;
  /** Optional semantic diff, when the task is about comparing two architectures. */
  readonly comparison?: {
    readonly baseSnapshotId: SnapshotId;
    readonly targetSnapshotId: SnapshotId;
    readonly changes: readonly EntityChange[];
  };
}

function toAgentEntity(
  entity: GraphSnapshot["entities"][number],
): AgentEntity {
  switch (entity.kind) {
    case "node":
      return {
        kind: "node",
        id: entity.id,
        label: entity.label,
        ...(entity.groupId !== undefined ? { groupId: entity.groupId } : {}),
      };
    case "edge":
      return {
        kind: "edge",
        id: entity.id,
        source: entity.source,
        target: entity.target,
        ...(entity.label !== undefined ? { label: entity.label } : {}),
      };
    case "group":
      return {
        kind: "group",
        id: entity.id,
        label: entity.label,
        memberIds: entity.memberIds,
      };
  }
}

export interface BuildAgentContextInput {
  readonly intent: string;
  readonly snapshot: GraphSnapshot;
  readonly comparison?: Comparison;
}

/**
 * Projects a snapshot (and optional comparison) into an {@link AgentContextPackage},
 * dropping layout and any renderer-specific data. This is the *only* supported way to build
 * the agent boundary, so the semantic-only guarantee lives in one place.
 */
export function buildAgentContextPackage(
  input: BuildAgentContextInput,
): AgentContextPackage {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    intent: input.intent,
    graph: {
      snapshotId: input.snapshot.id,
      diagramType: input.snapshot.source.diagramType,
      entities: input.snapshot.entities.map(toAgentEntity),
    },
    ...(input.comparison !== undefined
      ? {
          comparison: {
            baseSnapshotId: input.comparison.baseSnapshotId,
            targetSnapshotId: input.comparison.targetSnapshotId,
            changes: input.comparison.changes,
          },
        }
      : {}),
  };
}
