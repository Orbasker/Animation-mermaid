import { describe, expect, it } from "vitest";

import { snapshotId, type GraphSnapshot } from "@/domain/graph";
import {
  addProjectSnapshot,
  createProjectFromSnapshot,
  deriveProjectName,
  reimportActiveSnapshot,
  replaceProjectSnapshot,
  uniqueSnapshotId,
} from "@/domain/import-project";
import { importMermaidFlowchart } from "@/domain/mermaid/import";
import {
  createProjectDocument,
  projectId,
  validateProjectDocument,
} from "@/domain/project-document";

function importSnapshot(text: string, id: string): GraphSnapshot {
  const result = importMermaidFlowchart({
    text,
    snapshotId: snapshotId(id),
    importedAt: "2026-08-18T00:00:00.000Z",
  });
  if (!result.snapshot) throw new Error("expected a snapshot");
  return result.snapshot;
}

const AS_IS = "%% AS-IS catalog\nflowchart LR\n  a[Service] --> b[(Mongo)]";
const TO_BE = "%% TO-BE catalog\nflowchart LR\n  a[Service] --> c[(Postgres)]";

describe("uniqueSnapshotId", () => {
  it("returns the base id when it is free", () => {
    expect(uniqueSnapshotId([], "snapshot")).toBe("snapshot");
  });

  it("suffixes deterministically when the base is taken", () => {
    const existing = [snapshotId("snapshot"), snapshotId("snapshot-2")];
    expect(uniqueSnapshotId(existing, "snapshot")).toBe("snapshot-3");
  });
});

describe("deriveProjectName", () => {
  it("uses the first %% comment title", () => {
    expect(deriveProjectName(AS_IS, "fallback")).toBe("AS-IS catalog");
  });

  it("strips a trailing description after an em dash or colon", () => {
    expect(
      deriveProjectName(
        "%% catalog-new — TO-BE after Step 1\nflowchart LR",
        "x",
      ),
    ).toBe("catalog-new");
  });

  it("falls back when there is no leading comment", () => {
    expect(deriveProjectName("flowchart LR\n a-->b", "Imported diagram")).toBe(
      "Imported diagram",
    );
  });
});

describe("createProjectFromSnapshot", () => {
  it("builds a valid single-snapshot project", () => {
    const project = createProjectFromSnapshot({
      id: projectId("p1"),
      name: "New",
      snapshot: importSnapshot(AS_IS, "s1"),
    });
    expect(project.snapshots).toHaveLength(1);
    expect(validateProjectDocument(project)).toHaveLength(0);
  });
});

describe("addProjectSnapshot", () => {
  it("appends a snapshot, keeping a valid multi-snapshot project", () => {
    const project = createProjectFromSnapshot({
      id: projectId("p1"),
      name: "New",
      snapshot: importSnapshot(AS_IS, "s1"),
    });
    const next = addProjectSnapshot(project, importSnapshot(TO_BE, "s2"));
    expect(next.snapshots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(validateProjectDocument(next)).toHaveLength(0);
  });
});

describe("replaceProjectSnapshot", () => {
  it("replaces a snapshot by id, preserving order", () => {
    const project = createProjectDocument({
      id: projectId("p1"),
      name: "New",
      snapshots: [importSnapshot(AS_IS, "s1"), importSnapshot(TO_BE, "s2")],
    });
    const replacement = importSnapshot(
      "%% AS-IS v2\nflowchart LR\n a[Svc]-->b[(Mongo)]",
      "s1",
    );
    const next = replaceProjectSnapshot(project, replacement);
    expect(next.snapshots.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(next.snapshots[0].source.text).toContain("AS-IS v2");
  });

  it("appends a snapshot whose id is not present", () => {
    const project = createProjectFromSnapshot({
      id: projectId("p1"),
      name: "New",
      snapshot: importSnapshot(AS_IS, "s1"),
    });
    const next = replaceProjectSnapshot(project, importSnapshot(TO_BE, "s9"));
    expect(next.snapshots).toHaveLength(2);
  });
});

describe("reimportActiveSnapshot", () => {
  it("reconnects unchanged entities by semantic key into the active snapshot", () => {
    const original = importSnapshot(AS_IS, "s1");
    const withLayout: GraphSnapshot = {
      ...original,
      layout: [{ entityId: original.entities[0].id, x: 111, y: 222 }],
    };
    const project = createProjectFromSnapshot({
      id: projectId("p1"),
      name: "New",
      snapshot: withLayout,
    });
    const imported = importSnapshot(AS_IS, "reimport-tmp");

    const { project: next, reconciled } = reimportActiveSnapshot(
      project,
      snapshotId("s1"),
      imported,
    );

    expect(reconciled).not.toBeNull();
    expect(reconciled!.id).toBe("s1");
    expect(reconciled!.layout).toContainEqual({
      entityId: original.entities[0].id,
      x: 111,
      y: 222,
    });
    expect(next.snapshots[0].id).toBe("s1");
    expect(validateProjectDocument(next)).toHaveLength(0);
  });

  it("returns the project unchanged when the active id is unknown", () => {
    const project = createProjectFromSnapshot({
      id: projectId("p1"),
      name: "New",
      snapshot: importSnapshot(AS_IS, "s1"),
    });
    const { project: next, reconciled } = reimportActiveSnapshot(
      project,
      snapshotId("missing"),
      importSnapshot(TO_BE, "x"),
    );
    expect(reconciled).toBeNull();
    expect(next).toBe(project);
  });
});
