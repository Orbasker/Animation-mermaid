import {
  assertCurrentSchemaVersion,
  migrateDocument,
} from "@/domain/schema-version";
import type { ProjectDocument } from "@/domain/project-document";

/**
 * Serializes a project to a portable JSON string. This is the canonical on-disk / export
 * form; because the domain holds only plain, semantic data it serializes losslessly.
 */
export function serializeProjectDocument(project: ProjectDocument): string {
  return JSON.stringify(project);
}

/**
 * Parses a project from JSON, migrating older schema versions forward before asserting the
 * result is at the current version. A document already at {@link CURRENT_SCHEMA_VERSION}
 * passes through {@link migrateDocument} untouched, so a v1 project round-trips
 * (`parse(serialize(p))`) without semantic changes. Throws with an actionable message when
 * the payload is not an object or carries an unsupported version.
 */
export function parseProjectDocument(json: string): ProjectDocument {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Cannot parse project: expected a JSON object.");
  }

  const migrated = migrateDocument(parsed as Record<string, unknown>);
  assertCurrentSchemaVersion(migrated);
  return migrated as unknown as ProjectDocument;
}
