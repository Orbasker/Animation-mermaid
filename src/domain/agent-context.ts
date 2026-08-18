import {
  CURRENT_SCHEMA_VERSION,
  type Versioned,
} from "@/domain/schema-version";
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

function toAgentEntity(entity: GraphSnapshot["entities"][number]): AgentEntity {
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
 * Narrows a context package to a chosen subset of entities, dropping everything else and any
 * reference to it.
 *
 * This is the redaction primitive behind the copilot's context preview: a reviewer confirms
 * exactly which components are sent, and unselected content must be *absent* from the request,
 * not merely hidden. Filtering is not enough on its own — an included edge whose endpoint was
 * dropped, or a group whose members were dropped, would leak the excluded id back into the
 * payload — so this also prunes:
 *
 * - edges with a source or target that is not included;
 * - group members that are not included, and groups left with no members;
 * - a node's `groupId` when that group did not survive;
 * - comparison changes whose entity is not included.
 *
 * The result is a smaller-but-consistent {@link AgentContextPackage}. Passing every entity id
 * returns an equivalent package; passing none yields an empty graph, which the request schema
 * rejects — the caller is expected to keep at least one entity.
 */
export function redactAgentContext(
  context: AgentContextPackage,
  includedEntityIds: Iterable<EntityId>,
): AgentContextPackage {
  const included = new Set<EntityId>(includedEntityIds);

  // A group survives only if it is itself included and keeps at least one included member.
  // Resolved first so a node can decide whether to keep its `groupId` in the same pass.
  const survivingGroups = new Set<EntityId>();
  for (const entity of context.graph.entities) {
    if (
      entity.kind === "group" &&
      included.has(entity.id) &&
      entity.memberIds.some((id) => included.has(id))
    ) {
      survivingGroups.add(entity.id);
    }
  }

  const entities: AgentEntity[] = [];
  for (const entity of context.graph.entities) {
    if (!included.has(entity.id)) continue;
    switch (entity.kind) {
      case "node":
        entities.push({
          kind: "node",
          id: entity.id,
          label: entity.label,
          ...(entity.groupId !== undefined &&
          survivingGroups.has(entity.groupId)
            ? { groupId: entity.groupId }
            : {}),
        });
        break;
      case "edge":
        if (!included.has(entity.source) || !included.has(entity.target))
          continue;
        entities.push({
          kind: "edge",
          id: entity.id,
          source: entity.source,
          target: entity.target,
          ...(entity.label !== undefined ? { label: entity.label } : {}),
        });
        break;
      case "group":
        if (!survivingGroups.has(entity.id)) continue;
        entities.push({
          kind: "group",
          id: entity.id,
          label: entity.label,
          memberIds: entity.memberIds.filter((id) => included.has(id)),
        });
        break;
    }
  }

  const comparison =
    context.comparison !== undefined
      ? {
          baseSnapshotId: context.comparison.baseSnapshotId,
          targetSnapshotId: context.comparison.targetSnapshotId,
          changes: context.comparison.changes.filter((change) =>
            included.has(change.entityId),
          ),
        }
      : undefined;

  return {
    schemaVersion: context.schemaVersion,
    intent: context.intent,
    graph: {
      snapshotId: context.graph.snapshotId,
      diagramType: context.graph.diagramType,
      entities,
    },
    ...(comparison !== undefined ? { comparison } : {}),
  };
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
