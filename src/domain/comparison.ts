import { CURRENT_SCHEMA_VERSION, type Versioned } from "@/domain/schema-version";
import type { EntityId, GraphEntity, GraphSnapshot, SnapshotId } from "@/domain/graph";

export type ComparisonId = string & { readonly __brand: "ComparisonId" };

export function comparisonId(value: string): ComparisonId {
  return value as ComparisonId;
}

/**
 * One semantic difference between two snapshots, keyed by the id of the entity it concerns.
 * `added`/`removed` carry the whole entity; `modified` carries both sides so consumers can
 * describe *what* changed. Comparison is over semantic identity and content only — layout
 * coordinates never produce a change.
 */
export type EntityChange =
  | { readonly op: "added"; readonly entityId: EntityId; readonly after: GraphEntity }
  | { readonly op: "removed"; readonly entityId: EntityId; readonly before: GraphEntity }
  | {
      readonly op: "modified";
      readonly entityId: EntityId;
      readonly before: GraphEntity;
      readonly after: GraphEntity;
    };

/**
 * A versioned semantic diff between a base and a target {@link GraphSnapshot}. This is the
 * durable artifact that "compare current and proposed architectures" is built on: it
 * records snapshot identities plus the per-entity changes between them.
 */
export interface Comparison extends Versioned {
  readonly id: ComparisonId;
  readonly baseSnapshotId: SnapshotId;
  readonly targetSnapshotId: SnapshotId;
  readonly changes: readonly EntityChange[];
}

/**
 * Semantic fingerprint of an entity, excluding anything positional. Two entities with the
 * same id are "modified" iff their fingerprints differ, so re-layout alone never registers
 * as a change.
 */
function entityFingerprint(entity: GraphEntity): string {
  switch (entity.kind) {
    case "node":
      return JSON.stringify({
        kind: entity.kind,
        label: entity.label,
        groupId: entity.groupId ?? null,
        attributes: entity.attributes ?? {},
      });
    case "edge":
      return JSON.stringify({
        kind: entity.kind,
        source: entity.source,
        target: entity.target,
        label: entity.label ?? null,
        attributes: entity.attributes ?? {},
      });
    case "group":
      return JSON.stringify({
        kind: entity.kind,
        label: entity.label,
        memberIds: [...entity.memberIds],
      });
  }
}

/**
 * Computes the semantic {@link Comparison} between two snapshots. Entities present only in
 * `target` are `added`, present only in `base` are `removed`, and present in both with a
 * different semantic fingerprint are `modified`. Changes are ordered by entity id for a
 * deterministic, round-trippable result.
 */
export function compareSnapshots(
  id: ComparisonId,
  base: GraphSnapshot,
  target: GraphSnapshot,
): Comparison {
  const baseById = new Map(base.entities.map((entity) => [entity.id, entity]));
  const targetById = new Map(
    target.entities.map((entity) => [entity.id, entity]),
  );

  const changes: EntityChange[] = [];
  const allIds = [
    ...new Set<EntityId>([...baseById.keys(), ...targetById.keys()]),
  ].sort();

  for (const id of allIds) {
    const before = baseById.get(id);
    const after = targetById.get(id);
    if (before && !after) {
      changes.push({ op: "removed", entityId: id, before });
    } else if (!before && after) {
      changes.push({ op: "added", entityId: id, after });
    } else if (before && after) {
      if (entityFingerprint(before) !== entityFingerprint(after)) {
        changes.push({ op: "modified", entityId: id, before, after });
      }
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    baseSnapshotId: base.id,
    targetSnapshotId: target.id,
    changes,
  };
}

export type ComparisonValidationCode =
  | "comparison-base-mismatch"
  | "comparison-target-mismatch"
  | "change-entity-mismatch";

export interface ComparisonValidationError {
  readonly code: ComparisonValidationCode;
  readonly message: string;
  readonly entityId?: EntityId;
}

/**
 * Validates a comparison against the two snapshots it claims to relate: the snapshot ids
 * must match, and each change's declared side must actually be absent/present as its `op`
 * requires. Returns all problems found rather than throwing.
 */
export function validateComparison(
  comparison: Comparison,
  base: GraphSnapshot,
  target: GraphSnapshot,
): readonly ComparisonValidationError[] {
  const errors: ComparisonValidationError[] = [];

  if (comparison.baseSnapshotId !== base.id) {
    errors.push({
      code: "comparison-base-mismatch",
      message: `Comparison base "${comparison.baseSnapshotId}" does not match snapshot "${base.id}".`,
    });
  }
  if (comparison.targetSnapshotId !== target.id) {
    errors.push({
      code: "comparison-target-mismatch",
      message: `Comparison target "${comparison.targetSnapshotId}" does not match snapshot "${target.id}".`,
    });
  }

  const inBase = new Set<EntityId>(base.entities.map((entity) => entity.id));
  const inTarget = new Set<EntityId>(target.entities.map((entity) => entity.id));

  for (const change of comparison.changes) {
    const consistent =
      change.op === "added"
        ? !inBase.has(change.entityId) && inTarget.has(change.entityId)
        : change.op === "removed"
          ? inBase.has(change.entityId) && !inTarget.has(change.entityId)
          : inBase.has(change.entityId) && inTarget.has(change.entityId);
    if (!consistent) {
      errors.push({
        code: "change-entity-mismatch",
        entityId: change.entityId,
        message: `Change "${change.op}" for entity "${change.entityId}" is inconsistent with the snapshots.`,
      });
    }
  }

  return errors;
}
