/**
 * Every persisted document in Animation Mermaid carries a `schemaVersion` so that
 * older documents can be detected and migrated forward. Bump {@link CURRENT_SCHEMA_VERSION}
 * whenever the persisted shape of a document changes in a way that requires a migration,
 * add the new literal to {@link SchemaVersion}, and register a migration step (see
 * {@link migrateDocument}).
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/**
 * Every schema version this build understands. The current version is always the last
 * entry; older entries exist so that migrations can step a document forward one version
 * at a time.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

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

/**
 * Ordered registry of migrations, keyed by the version they migrate *from*. Version 1 is
 * the initial schema, so there are no migrations yet; when the schema next changes, add a
 * `{ from: 1, to: 2, migrate }` entry here.
 */
export const MIGRATIONS: readonly Migration[] = [];

/**
 * Migrates an arbitrary persisted document forward to {@link CURRENT_SCHEMA_VERSION} by
 * applying registered {@link MIGRATIONS} in order. Throws when the document has no
 * recognized version or when no migration path reaches the current version. A document
 * already at the current version is returned unchanged, which keeps v1 round-trips exact.
 */
export function migrateDocument(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const version = document.schemaVersion;
  if (!isSupportedSchemaVersion(version)) {
    throw new Error(
      `Cannot migrate document with unsupported schemaVersion: ${String(
        version,
      )}.`,
    );
  }

  let current = document;
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
