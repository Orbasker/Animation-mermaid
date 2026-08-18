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
  const attributes = (value: Readonly<Record<string, string>> | undefined) =>
    Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ));

  switch (entity.kind) {
    case "node":
      return JSON.stringify({
        kind: entity.kind,
        label: entity.label,
        groupId: entity.groupId ?? null,
        attributes: attributes(entity.attributes),
      });
    case "edge":
      return JSON.stringify({
        kind: entity.kind,
        source: entity.source,
        target: entity.target,
        label: entity.label ?? null,
        attributes: attributes(entity.attributes),
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
  | "change-entity-mismatch"
  | "change-entity-id-mismatch"
  | "change-payload-mismatch"
  | "duplicate-change-entity"
  | "missing-change"
  | "unexpected-change";

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

  const canonical = compareSnapshots(comparison.id, base, target);
  const expectedById = new Map(
    canonical.changes.map((change) => [change.entityId, change]),
  );
  const actualById = new Map<EntityId, EntityChange>();

  for (const change of comparison.changes) {
    if (actualById.has(change.entityId)) {
      errors.push({
        code: "duplicate-change-entity",
        entityId: change.entityId,
        message: `Comparison contains duplicate changes for entity "${change.entityId}".`,
      });
      continue;
    }
    actualById.set(change.entityId, change);

    const embeddedIds =
      change.op === "added"
        ? [change.after.id]
        : change.op === "removed"
          ? [change.before.id]
          : [change.before.id, change.after.id];
    if (embeddedIds.some((id) => id !== change.entityId)) {
      errors.push({
        code: "change-entity-id-mismatch",
        entityId: change.entityId,
        message: `Change "${change.op}" for "${change.entityId}" contains an entity with a different id.`,
      });
    }

    const expected = expectedById.get(change.entityId);
    if (!expected) {
      errors.push({
        code: "unexpected-change",
        entityId: change.entityId,
        message: `Comparison contains an unexpected change for entity "${change.entityId}".`,
      });
    } else if (!sameChangePayload(change, expected)) {
      errors.push({
        code: "change-payload-mismatch",
        entityId: change.entityId,
        message: `Change payload for entity "${change.entityId}" does not match the canonical snapshot difference.`,
      });
    }
  }

  for (const expected of canonical.changes) {
    if (!actualById.has(expected.entityId)) {
      errors.push({
        code: "missing-change",
        entityId: expected.entityId,
        message: `Comparison is missing the canonical change for entity "${expected.entityId}".`,
      });
    }
  }

  return errors;
}

function sameChangePayload(left: EntityChange, right: EntityChange): boolean {
  if (left.op !== right.op) {
    return false;
  }
  switch (left.op) {
    case "added":
      return right.op === "added" &&
        entityFingerprint(left.after) === entityFingerprint(right.after);
    case "removed":
      return right.op === "removed" &&
        entityFingerprint(left.before) === entityFingerprint(right.before);
    case "modified":
      return right.op === "modified" &&
        entityFingerprint(left.before) === entityFingerprint(right.before) &&
        entityFingerprint(left.after) === entityFingerprint(right.after);
  }
}
