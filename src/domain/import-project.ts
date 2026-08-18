import { reconcileImportedSnapshot } from "@/domain/editor";
import {
  snapshotId,
  type GraphSnapshot,
  type SnapshotId,
} from "@/domain/graph";
import {
  createProjectDocument,
  type ProjectDocument,
  type ProjectId,
} from "@/domain/project-document";

/**
 * Where an imported diagram lands relative to the project already open in the editor:
 *
 * - `new-project` — start a fresh project whose only snapshot is the import.
 * - `replace-active` — reimport into the active snapshot, reconnecting unchanged entities by
 *   semantic key so layout overrides and story references survive (the existing "Reimport
 *   source" behavior, now with user-supplied text).
 * - `add-snapshot` — keep the current snapshots and add the import as a new one, so a project
 *   can hold several diagrams at once (e.g. an AS-IS and a TO-BE).
 */
export type ImportDestination =
  "new-project" | "replace-active" | "add-snapshot";

/**
 * Returns a {@link SnapshotId} derived from `base` that does not collide with any of
 * `existing`. `base` is used verbatim when free; otherwise `-2`, `-3`, … is appended. The
 * result is deterministic for a given set of existing ids, so a re-run produces the same id.
 */
export function uniqueSnapshotId(
  existing: readonly SnapshotId[],
  base: string,
): SnapshotId {
  const taken = new Set<string>(existing);
  if (!taken.has(base)) return snapshotId(base);
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return snapshotId(candidate);
  }
}

/**
 * Derives a human project name for a freshly imported diagram: the first `%%` comment line in
 * the source (a diagram title, by convention), otherwise `fallback`. Never returns an empty
 * string.
 */
export function deriveProjectName(source: string, fallback: string): string {
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("%%")) {
      if (line.length > 0) break;
      continue;
    }
    const title = line
      .replace(/^%%\{[\s\S]*\}%%$/, "")
      .replace(/^%%+/, "")
      .split("—")[0]
      .split(":")[0]
      .trim();
    if (title.length > 0) return title;
  }
  return fallback;
}

/** Builds a single-snapshot {@link ProjectDocument} from a freshly imported snapshot. */
export function createProjectFromSnapshot(input: {
  readonly id: ProjectId;
  readonly name: string;
  readonly snapshot: GraphSnapshot;
}): ProjectDocument {
  return createProjectDocument({
    id: input.id,
    name: input.name,
    snapshots: [input.snapshot],
  });
}

/** Appends an imported snapshot to a project, leaving existing snapshots and stories intact. */
export function addProjectSnapshot(
  project: ProjectDocument,
  snapshot: GraphSnapshot,
): ProjectDocument {
  return { ...project, snapshots: [...project.snapshots, snapshot] };
}

/**
 * Replaces the snapshot in `project` whose id matches `snapshot`, preserving order. A
 * snapshot with an id not already present is appended, so callers cannot silently drop an
 * import.
 */
export function replaceProjectSnapshot(
  project: ProjectDocument,
  snapshot: GraphSnapshot,
): ProjectDocument {
  const exists = project.snapshots.some((item) => item.id === snapshot.id);
  return {
    ...project,
    snapshots: exists
      ? project.snapshots.map((item) =>
          item.id === snapshot.id ? snapshot : item,
        )
      : [...project.snapshots, snapshot],
  };
}

/**
 * Reimports `imported` into the active snapshot of `project`, reconnecting unchanged entities
 * by semantic key. Returns the project unchanged and `reconciled: null` when `activeId`
 * matches no snapshot, so the caller can surface the mismatch rather than corrupt the
 * document.
 */
export function reimportActiveSnapshot(
  project: ProjectDocument,
  activeId: SnapshotId,
  imported: GraphSnapshot,
): {
  readonly project: ProjectDocument;
  readonly reconciled: GraphSnapshot | null;
} {
  const previous = project.snapshots.find((item) => item.id === activeId);
  if (!previous) return { project, reconciled: null };
  const reconciled = reconcileImportedSnapshot(previous, {
    ...imported,
    id: activeId,
  });
  return { project: replaceProjectSnapshot(project, reconciled), reconciled };
}
