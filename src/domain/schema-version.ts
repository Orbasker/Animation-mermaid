/**
 * Every persisted document in Animation Mermaid carries a `schemaVersion` so that
 * older documents can be detected and migrated forward. Bump {@link CURRENT_SCHEMA_VERSION}
 * whenever the persisted shape of a document changes in a way that requires a migration,
 * add the new literal to {@link SchemaVersion}, and register a migration step (see
 * {@link migrateDocument}).
 */
export const CURRENT_SCHEMA_VERSION = 2 as const;

/**
 * Every schema version this build understands. The current version is always the last
 * entry; older entries exist so that migrations can step a document forward one version
 * at a time.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

/** A document that participates in schema versioning. */
export interface Versioned {
  readonly schemaVersion: SchemaVersion;
}

/** True when `value` is a schema version this build understands. */
export function isSupportedSchemaVersion(
  value: unknown,
): value is SchemaVersion {
  return (
    typeof value === "number" &&
    (SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(value)
  );
}

/** True when `value` is the newest schema version this build emits. */
export function isCurrentSchemaVersion(value: unknown): value is SchemaVersion {
  return value === CURRENT_SCHEMA_VERSION;
}

/**
 * Narrows an unknown persisted document to the current schema version, throwing when the
 * version is missing or not the current one. Callers that accept older documents should
 * run {@link migrateDocument} first.
 */
export function assertCurrentSchemaVersion(document: {
  readonly schemaVersion?: unknown;
}): asserts document is Versioned {
  if (!isCurrentSchemaVersion(document.schemaVersion)) {
    throw new Error(
      `Unsupported schemaVersion: ${String(
        document.schemaVersion,
      )}. Expected ${CURRENT_SCHEMA_VERSION}.`,
    );
  }
}

/**
 * A single forward migration: takes a document at version `from` and returns it at the
 * next version. Migrations are chained by {@link migrateDocument} so each step only has to
 * know how to move a document forward by one version.
 */
export interface Migration {
  readonly from: SchemaVersion;
  readonly to: SchemaVersion;
  readonly migrate: (document: Record<string, unknown>) => Record<string, unknown>;
}

type PersistedArtifactKind =
  | "ProjectDocument"
  | "GraphSnapshot"
  | "Story"
  | "Comparison";

function migrationError(path: string, expectation: string): never {
  throw new Error(`Cannot migrate ${path}: ${expectation}.`);
}

function migrationRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    migrationError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function migrationArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    migrationError(path, "expected an array");
  }
  return value;
}

function migrationString(value: unknown, path: string): void {
  if (typeof value !== "string") {
    migrationError(path, "expected a string");
  }
}

function migrationNumber(value: unknown, path: string): void {
  if (typeof value !== "number") {
    migrationError(path, "expected a number");
  }
}

function validateV1Attributes(value: unknown, path: string): void {
  if (value === undefined) {
    return;
  }
  const attributes = migrationRecord(value, path);
  for (const [key, attribute] of Object.entries(attributes)) {
    migrationString(attribute, `${path}.${key}`);
  }
}

function validateV1GraphEntity(value: unknown, path: string): void {
  const entity = migrationRecord(value, path);
  migrationString(entity.id, `${path}.id`);
  migrationString(entity.kind, `${path}.kind`);
  validateV1Attributes(entity.attributes, `${path}.attributes`);
  switch (entity.kind) {
    case "node":
      migrationString(entity.label, `${path}.label`);
      if (entity.groupId !== undefined) {
        migrationString(entity.groupId, `${path}.groupId`);
      }
      break;
    case "edge":
      migrationString(entity.source, `${path}.source`);
      migrationString(entity.target, `${path}.target`);
      if (entity.label !== undefined) {
        migrationString(entity.label, `${path}.label`);
      }
      break;
    case "group":
      migrationString(entity.label, `${path}.label`);
      migrationArray(entity.memberIds, `${path}.memberIds`).forEach((member, index) =>
        migrationString(member, `${path}.memberIds[${index}]`),
      );
      break;
    default:
      migrationError(`${path}.kind`, `unsupported entity kind "${String(entity.kind)}"`);
  }
}

function validateV1Snapshot(value: unknown, path: string): Record<string, unknown> {
  const snapshot = migrationRecord(value, path);
  if (snapshot.schemaVersion !== 1) {
    migrationError(path, "expected nested schemaVersion 1");
  }
  migrationString(snapshot.id, `${path}.id`);
  const source = migrationRecord(snapshot.source, `${path}.source`);
  migrationString(source.diagramType, `${path}.source.diagramType`);
  migrationString(source.text, `${path}.source.text`);
  const importer = migrationRecord(source.importer, `${path}.source.importer`);
  migrationString(importer.importer, `${path}.source.importer.importer`);
  migrationString(
    importer.importerVersion,
    `${path}.source.importer.importerVersion`,
  );
  migrationString(importer.importedAt, `${path}.source.importer.importedAt`);
  migrationArray(snapshot.entities, `${path}.entities`).forEach((entity, index) =>
    validateV1GraphEntity(entity, `${path}.entities[${index}]`),
  );
  if (snapshot.layout !== undefined) {
    migrationArray(snapshot.layout, `${path}.layout`).forEach((value, index) => {
      const layout = migrationRecord(value, `${path}.layout[${index}]`);
      migrationString(layout.entityId, `${path}.layout[${index}].entityId`);
      migrationNumber(layout.x, `${path}.layout[${index}].x`);
      migrationNumber(layout.y, `${path}.layout[${index}].y`);
      if (layout.width !== undefined) {
        migrationNumber(layout.width, `${path}.layout[${index}].width`);
      }
      if (layout.height !== undefined) {
        migrationNumber(layout.height, `${path}.layout[${index}].height`);
      }
    });
  }
  return snapshot;
}

function validateV1Action(value: unknown, path: string): void {
  const action = migrationRecord(value, path);
  migrationString(action.type, `${path}.type`);
  if (
    action.type === "focus" ||
    action.type === "trace" ||
    action.type === "transform" ||
    action.type === "compare"
  ) {
    migrationError(
      path,
      `action "${action.type}" is not supported in schemaVersion 1`,
    );
  }
  switch (action.type) {
    case "reveal":
    case "hide":
      migrationString(action.target, `${path}.target`);
      break;
    case "highlight":
      migrationString(action.target, `${path}.target`);
      if (action.style !== undefined) {
        migrationString(action.style, `${path}.style`);
      }
      break;
    case "annotate":
      migrationString(action.target, `${path}.target`);
      migrationString(action.text, `${path}.text`);
      break;
    case "camera":
      migrationArray(action.focus, `${path}.focus`).forEach((target, index) =>
        migrationString(target, `${path}.focus[${index}]`),
      );
      break;
    default:
      migrationError(path, `unsupported schemaVersion 1 action "${String(action.type)}"`);
  }
}

function validateV1Story(value: unknown, path: string): Record<string, unknown> {
  const story = migrationRecord(value, path);
  if (story.schemaVersion !== 1) {
    migrationError(path, "expected nested schemaVersion 1");
  }
  migrationString(story.id, `${path}.id`);
  migrationString(story.title, `${path}.title`);
  migrationString(story.snapshotId, `${path}.snapshotId`);
  migrationArray(story.scenes, `${path}.scenes`).forEach((value, sceneIndex) => {
    const scenePath = `${path}.scenes[${sceneIndex}]`;
    const scene = migrationRecord(value, scenePath);
    migrationString(scene.id, `${scenePath}.id`);
    migrationString(scene.title, `${scenePath}.title`);
    migrationNumber(scene.durationMs, `${scenePath}.durationMs`);
    migrationArray(scene.actions, `${scenePath}.actions`).forEach(
      (action, actionIndex) =>
        validateV1Action(action, `${scenePath}.actions[${actionIndex}]`),
    );
  });
  return story;
}

function validateV1Change(value: unknown, path: string): void {
  const change = migrationRecord(value, path);
  migrationString(change.op, `${path}.op`);
  migrationString(change.entityId, `${path}.entityId`);
  switch (change.op) {
    case "added":
      validateV1GraphEntity(change.after, `${path}.after`);
      break;
    case "removed":
      validateV1GraphEntity(change.before, `${path}.before`);
      break;
    case "modified":
      validateV1GraphEntity(change.before, `${path}.before`);
      validateV1GraphEntity(change.after, `${path}.after`);
      break;
    default:
      migrationError(`${path}.op`, `unsupported change operation "${String(change.op)}"`);
  }
}

function validateV1Comparison(
  value: unknown,
  path: string,
): Record<string, unknown> {
  const comparison = migrationRecord(value, path);
  if (comparison.schemaVersion !== 1) {
    migrationError(path, "expected nested schemaVersion 1");
  }
  migrationString(comparison.id, `${path}.id`);
  migrationString(comparison.baseSnapshotId, `${path}.baseSnapshotId`);
  migrationString(comparison.targetSnapshotId, `${path}.targetSnapshotId`);
  migrationArray(comparison.changes, `${path}.changes`).forEach((change, index) =>
    validateV1Change(change, `${path}.changes[${index}]`),
  );
  return comparison;
}

function detectV1Artifact(document: Record<string, unknown>): PersistedArtifactKind {
  if (
    "snapshots" in document ||
    "stories" in document ||
    "comparisons" in document
  ) {
    return "ProjectDocument";
  }
  if ("source" in document || "entities" in document) {
    return "GraphSnapshot";
  }
  if ("snapshotId" in document || "scenes" in document) {
    return "Story";
  }
  if (
    "baseSnapshotId" in document ||
    "targetSnapshotId" in document ||
    "changes" in document
  ) {
    return "Comparison";
  }
  return migrationError("schemaVersion 1 document", "unknown artifact shape");
}

function migrateV1Artifact(document: Record<string, unknown>): Record<string, unknown> {
  const kind = detectV1Artifact(document);
  switch (kind) {
    case "GraphSnapshot":
      validateV1Snapshot(document, "GraphSnapshot");
      return { ...document, schemaVersion: 2 };
    case "Story":
      validateV1Story(document, "Story");
      return { ...document, schemaVersion: 2 };
    case "Comparison":
      validateV1Comparison(document, "Comparison");
      return { ...document, schemaVersion: 2 };
    case "ProjectDocument": {
      migrationString(document.id, "ProjectDocument.id");
      migrationString(document.name, "ProjectDocument.name");
      const snapshots = migrationArray(document.snapshots, "ProjectDocument.snapshots");
      const stories = migrationArray(document.stories, "ProjectDocument.stories");
      const comparisons = migrationArray(
        document.comparisons,
        "ProjectDocument.comparisons",
      );
      return {
        ...document,
        schemaVersion: 2,
        snapshots: snapshots.map((snapshot, index) => ({
          ...validateV1Snapshot(snapshot, `snapshots[${index}]`),
          schemaVersion: 2,
        })),
        stories: stories.map((story, index) => ({
          ...validateV1Story(story, `stories[${index}]`),
          schemaVersion: 2,
        })),
        comparisons: comparisons.map((comparison, index) => ({
          ...validateV1Comparison(comparison, `comparisons[${index}]`),
          schemaVersion: 2,
        })),
      };
    }
  }
}

/**
 * Ordered registry of migrations, keyed by the version they migrate *from*.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    from: 1,
    to: 2,
    migrate: migrateV1Artifact,
  },
];

/**
 * Migrates an arbitrary persisted document forward to {@link CURRENT_SCHEMA_VERSION} by
 * applying registered {@link MIGRATIONS} in order. Throws when the document has no
 * recognized version or when no migration path reaches the current version. A document
 * already at the current version is returned unchanged.
 */
export function migrateDocument<
  T extends { readonly schemaVersion?: unknown },
>(document: T): Record<string, unknown> {
  const version = document.schemaVersion;
  if (!isSupportedSchemaVersion(version)) {
    throw new Error(
      `Cannot migrate document with unsupported schemaVersion: ${String(
        version,
      )}.`,
    );
  }

  let current = document as Record<string, unknown>;
  let currentVersion: SchemaVersion = version;
  while (currentVersion !== CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS.find(
      (migration) => migration.from === currentVersion,
    );
    if (!step) {
      throw new Error(
        `No migration registered from schemaVersion ${currentVersion} to ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
    current = step.migrate(current);
    currentVersion = step.to;
  }

  return current;
}
