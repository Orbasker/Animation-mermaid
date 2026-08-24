"use client";

import type { ProjectDocument } from "@/domain/project-document";
import type { EdgeEntity, NodeEntity } from "@/domain/graph";

import type { ProjectSummary } from "@/app/_components/diagnostics";

/**
 * A tab-scoped snapshot of the open project, kept so a recovery surface can offer to download it
 * even after the editor subtree has crashed and unmounted. The editor records the latest project
 * on every change; the error boundary — which has no access to component state — reads it back.
 *
 * It lives in a module singleton for the live case and mirrors to sessionStorage so it survives a
 * remount, staying scoped to the tab and cleared when the tab closes.
 */

const STORAGE_KEY = "animation-mermaid:project-backup";

interface BackupRecord {
  readonly savedAt: string;
  readonly project: ProjectDocument;
}

let latest: BackupRecord | undefined;

export function recordProjectBackup(project: ProjectDocument): void {
  latest = { savedAt: new Date().toISOString(), project };
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
  } catch {
    // Quota or serialization failure — the in-memory copy still serves the live case.
  }
}

export function readProjectBackup(): BackupRecord | undefined {
  if (latest) return latest;
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as BackupRecord;
  } catch {
    return undefined;
  }
}

export function clearProjectBackup(): void {
  latest = undefined;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing actionable if the store rejects the removal.
  }
}

/** Non-identifying counts for diagnostics — never labels, annotations, or source text. */
export function summarizeProject(project: ProjectDocument): ProjectSummary {
  let nodes = 0;
  let edges = 0;
  for (const snapshot of project.snapshots) {
    for (const entity of snapshot.entities) {
      if ((entity as NodeEntity).kind === "node") nodes += 1;
      else if ((entity as EdgeEntity).kind === "edge") edges += 1;
    }
  }
  return {
    snapshots: project.snapshots.length,
    nodes,
    edges,
    stories: project.stories.length,
  };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/**
 * Triggers a download of the backed-up project as JSON so a reviewer never loses work to a
 * crash. Returns false when there is nothing to export or the browser cannot download.
 */
export function downloadProjectBackup(): boolean {
  const record = readProjectBackup();
  if (
    !record ||
    typeof document === "undefined" ||
    typeof URL === "undefined"
  ) {
    return false;
  }
  const blob = new Blob([JSON.stringify(record.project, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(record.project.name)}-backup.json`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
