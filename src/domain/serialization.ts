import {
  migrateDocument,
} from "@/domain/schema-version";
import {
  validateProjectDocument,
  type ProjectDocument,
} from "@/domain/project-document";
import { decodeProjectDocument } from "@/domain/runtime-decoder";

function assertValidProjectDocument(
  project: ProjectDocument,
  operation: "parse" | "serialize",
): void {
  const errors = validateProjectDocument(project);
  if (errors.length > 0) {
    throw new Error(
      `Cannot ${operation} invalid project: ${errors
        .map((error) => error.message)
        .join(" ")}`,
    );
  }
}

/**
 * Serializes a project to a portable JSON string. This is the canonical on-disk / export
 * form; because the domain holds only plain, semantic data it serializes losslessly.
 */
export function serializeProjectDocument(project: ProjectDocument): string {
  const decoded = decodeProjectDocument(project);
  assertValidProjectDocument(decoded, "serialize");
  return JSON.stringify(decoded);
}

/**
 * Parses a project from JSON, migrating older schema versions forward before asserting the
 * result is at the current version. A document already at {@link CURRENT_SCHEMA_VERSION}
 * passes through {@link migrateDocument} untouched, so a current project round-trips
 * (`parse(serialize(p))`) without semantic changes. Throws with an actionable message when
 * the payload is not an object or carries an unsupported version.
 */
export function parseProjectDocument(json: string): ProjectDocument {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Cannot parse project: expected a JSON object.");
  }

  const migrated = migrateDocument(parsed as Record<string, unknown>);
  const project = decodeProjectDocument(migrated);
  assertValidProjectDocument(project, "parse");
  return project;
}
