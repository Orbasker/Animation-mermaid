/**
 * Every persisted document in Animation Mermaid carries a `schemaVersion` so that
 * older documents can be detected and migrated forward. Bump `CURRENT_SCHEMA_VERSION`
 * whenever the shape of {@link ProjectGraph}, {@link SceneDocument}, or {@link Project}
 * changes in a way that requires a migration, and add the new literal to `SchemaVersion`.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;

/** A document that participates in schema versioning. */
export interface Versioned {
  readonly schemaVersion: SchemaVersion;
}

/** True when `value` is a schema version this build understands. */
export function isCurrentSchemaVersion(value: unknown): value is SchemaVersion {
  return value === CURRENT_SCHEMA_VERSION;
}

/**
 * Narrows an unknown persisted document to a known schema version, throwing when the
 * version is missing or unsupported. Callers that need to migrate should branch on the
 * version before calling this.
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
