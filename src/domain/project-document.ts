import {
  CURRENT_SCHEMA_VERSION,
  type Versioned,
} from "@/domain/schema-version";
import {
  validateGraphSnapshot,
  type GraphSnapshot,
  type SnapshotId,
} from "@/domain/graph";
import { validateStory, type Story } from "@/domain/story";
import { validateComparison, type Comparison } from "@/domain/comparison";

export type ProjectId = string & { readonly __brand: "ProjectId" };

export function projectId(value: string): ProjectId {
  return value as ProjectId;
}

/**
 * The top-level persisted unit of work. A project holds a history of {@link GraphSnapshot}s
 * (the versioned diagram), the {@link Story}s animated over them, and any {@link Comparison}s
 * between snapshots. The container is versioned independently of the documents it holds so
 * the file format can evolve on its own.
 */
export interface ProjectDocument extends Versioned {
  readonly id: ProjectId;
  readonly name: string;
  readonly snapshots: readonly GraphSnapshot[];
  readonly stories: readonly Story[];
  readonly comparisons: readonly Comparison[];
}

export interface CreateProjectDocumentInput {
  readonly id: ProjectId;
  readonly name: string;
  readonly snapshots?: readonly GraphSnapshot[];
  readonly stories?: readonly Story[];
  readonly comparisons?: readonly Comparison[];
}

/** Builds a {@link ProjectDocument} at the current schema version. */
export function createProjectDocument(
  input: CreateProjectDocumentInput,
): ProjectDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    snapshots: input.snapshots ?? [],
    stories: input.stories ?? [],
    comparisons: input.comparisons ?? [],
  };
}

export interface ProjectValidationError {
  readonly scope: "project" | "snapshot" | "story" | "comparison";
  readonly code: string;
  readonly message: string;
}

function findSnapshot(
  project: ProjectDocument,
  id: SnapshotId,
): GraphSnapshot | undefined {
  return project.snapshots.find((snapshot) => snapshot.id === id);
}

/**
 * Validates a project end to end: every snapshot's referential integrity, each story
 * against the snapshot it targets (which must exist), and each comparison against the two
 * snapshots it relates (which must exist). Snapshot/story/comparison ids must each be
 * unique. Returns every problem found — tagged with the document it came from — rather than
 * throwing, so a UI can list them all with actionable messages.
 */
export function validateProjectDocument(
  project: ProjectDocument,
): readonly ProjectValidationError[] {
  const errors: ProjectValidationError[] = [];

  const seenSnapshotIds = new Set<SnapshotId>();
  for (const snapshot of project.snapshots) {
    if (seenSnapshotIds.has(snapshot.id)) {
      errors.push({
        scope: "project",
        code: "duplicate-snapshot-id",
        message: `Duplicate snapshot id "${snapshot.id}".`,
      });
    }
    seenSnapshotIds.add(snapshot.id);

    for (const error of validateGraphSnapshot(snapshot)) {
      errors.push({
        scope: "snapshot",
        code: error.code,
        message: `Snapshot "${snapshot.id}": ${error.message}`,
      });
    }
  }

  const seenStoryIds = new Set<string>();
  for (const story of project.stories) {
    if (seenStoryIds.has(story.id)) {
      errors.push({
        scope: "project",
        code: "duplicate-story-id",
        message: `Duplicate story id "${story.id}".`,
      });
    }
    seenStoryIds.add(story.id);

    const snapshot = findSnapshot(project, story.snapshotId);
    if (!snapshot) {
      errors.push({
        scope: "story",
        code: "story-missing-snapshot",
        message: `Story "${story.id}" targets unknown snapshot "${story.snapshotId}".`,
      });
      continue;
    }
    for (const error of validateStory(story, snapshot)) {
      errors.push({
        scope: "story",
        code: error.code,
        message: `Story "${story.id}": ${error.message}`,
      });
    }
  }

  const seenComparisonIds = new Set<string>();
  for (const comparison of project.comparisons) {
    if (seenComparisonIds.has(comparison.id)) {
      errors.push({
        scope: "project",
        code: "duplicate-comparison-id",
        message: `Duplicate comparison id "${comparison.id}".`,
      });
    }
    seenComparisonIds.add(comparison.id);

    const base = findSnapshot(project, comparison.baseSnapshotId);
    const target = findSnapshot(project, comparison.targetSnapshotId);
    if (!base || !target) {
      errors.push({
        scope: "comparison",
        code: "comparison-missing-snapshot",
        message: `Comparison "${comparison.id}" references unknown snapshot(s) "${comparison.baseSnapshotId}" / "${comparison.targetSnapshotId}".`,
      });
      continue;
    }
    for (const error of validateComparison(comparison, base, target)) {
      errors.push({
        scope: "comparison",
        code: error.code,
        message: `Comparison "${comparison.id}": ${error.message}`,
      });
    }
  }

  return errors;
}

/** True when a project has no validation errors. */
export function isValidProjectDocument(project: ProjectDocument): boolean {
  return validateProjectDocument(project).length === 0;
}
