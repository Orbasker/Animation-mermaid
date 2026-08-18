import { describe, expect, it } from "vitest";

import {
  applyEditorTransaction,
  commitEditorTransaction,
  createEditorHistory,
  createStressSnapshot,
  reconcileImportedSnapshot,
  redoEditorHistory,
  undoEditorHistory,
} from "@/domain/editor";
import { createGraphSnapshot, entityId, validateGraphSnapshot } from "@/domain/graph";
import { currentArchitectureSnapshot } from "@/domain/fixtures";

const source = {
  diagramType: "flowchart",
  text: "flowchart LR\n  a[A]\n  b[B]\n  a --> b",
  importer: {
    importer: "test",
    importerVersion: "1",
    importedAt: "2026-08-18T00:00:00.000Z",
  },
} as const;

describe("graph editor transactions", () => {
  it("applies visual mutations without changing source or semantic entities", () => {
    const original = currentArchitectureSnapshot();
    const moved = applyEditorTransaction(original, {
      type: "move",
      entityId: entityId("client"),
      x: 180,
      y: 96,
    });
    const hidden = applyEditorTransaction(moved, {
      type: "set-hidden",
      entityIds: [entityId("db")],
      hidden: true,
    });
    const grouped = applyEditorTransaction(hidden, {
      type: "group",
      id: "visual-critical-path",
      label: "Critical path",
      memberIds: [entityId("client"), entityId("api")],
    });
    const annotated = applyEditorTransaction(grouped, {
      type: "annotate",
      id: "note-client",
      entityId: entityId("client"),
      text: "Public entry point",
    });

    expect(annotated.source).toEqual(original.source);
    expect(annotated.entities).toEqual(original.entities);
    expect(annotated.layout?.find((hint) => hint.entityId === "client")).toMatchObject({
      x: 180,
      y: 96,
    });
    expect(annotated.view).toEqual({
      hiddenEntityIds: ["db"],
      groups: [
        {
          id: "visual-critical-path",
          label: "Critical path",
          memberIds: ["client", "api"],
        },
      ],
      annotations: [
        {
          id: "note-client",
          entityId: "client",
          text: "Public entry point",
        },
      ],
    });
  });

  it("undoes and redoes complete document mutations", () => {
    const history = createEditorHistory(currentArchitectureSnapshot());
    const changed = commitEditorTransaction(history, {
      type: "set-hidden",
      entityIds: [entityId("db")],
      hidden: true,
    });

    const undone = undoEditorHistory(changed);
    const redone = redoEditorHistory(undone);

    expect(undone.present.view?.hiddenEntityIds ?? []).toEqual([]);
    expect(redone.present.view?.hiddenEntityIds).toEqual(["db"]);
    expect(redone.past).toHaveLength(1);
  });
});

describe("reimport reconciliation", () => {
  it("preserves compatible visual edits by semantic id and drops removed references", () => {
    const previous = applyEditorTransaction(
      applyEditorTransaction(currentArchitectureSnapshot(), {
        type: "move",
        entityId: entityId("client"),
        x: 420,
        y: 160,
      }),
      {
        type: "set-hidden",
        entityIds: [entityId("db")],
        hidden: true,
      },
    );
    const imported = createGraphSnapshot({
      id: previous.id,
      source: { ...source, text: `${source.text}\n  c[C]` },
      entities: [
        { kind: "node", id: entityId("client"), label: "Client renamed" },
        { kind: "node", id: entityId("c"), label: "C" },
      ],
      layout: [
        { entityId: entityId("client"), x: 10, y: 10 },
        { entityId: entityId("c"), x: 240, y: 10 },
      ],
    });

    const reconciled = reconcileImportedSnapshot(previous, imported);

    expect(reconciled.source.text).toContain("c[C]");
    expect(reconciled.layout?.find((hint) => hint.entityId === "client")).toMatchObject({
      x: 420,
      y: 160,
    });
    expect(reconciled.layout?.find((hint) => hint.entityId === "c")).toMatchObject({
      x: 240,
      y: 10,
    });
    expect(reconciled.view?.hiddenEntityIds).toEqual([]);
  });
});

describe("stress fixture", () => {
  it("creates a valid, positioned 200-node architecture graph", () => {
    const snapshot = createStressSnapshot(200);
    const nodes = snapshot.entities.filter((entity) => entity.kind === "node");

    expect(nodes).toHaveLength(200);
    expect(snapshot.layout).toHaveLength(200);
    expect(snapshot.source.text).toContain("service-1 --> service-2");
    expect(snapshot.source.text).toContain("service-199 --> service-200");
    expect(validateGraphSnapshot(snapshot)).toEqual([]);
  });
});
