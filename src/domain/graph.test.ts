import { describe, expect, it } from "vitest";

import {
  createGraphSnapshot,
  entityId,
  snapshotId,
  validateGraphSnapshot,
} from "@/domain/graph";
import { currentArchitectureSnapshot } from "@/domain/fixtures";

const source = {
  diagramType: "flowchart",
  text: "flowchart TD",
  importer: {
    importer: "test",
    importerVersion: "0.0.0",
    importedAt: "2026-08-18T00:00:00.000Z",
  },
} as const;

describe("validateGraphSnapshot", () => {
  it("accepts the representative snapshot", () => {
    expect(validateGraphSnapshot(currentArchitectureSnapshot())).toEqual([]);
  });

  it("keeps layout separate from semantic identity", () => {
    const snapshot = currentArchitectureSnapshot();
    for (const entity of snapshot.entities) {
      expect(entity).not.toHaveProperty("x");
      expect(entity).not.toHaveProperty("y");
    }
    expect(snapshot.layout?.length ?? 0).toBeGreaterThan(0);
  });

  it("preserves original source and importer provenance", () => {
    const snapshot = currentArchitectureSnapshot();
    expect(snapshot.source.text).toContain("flowchart TD");
    expect(snapshot.source.importer.importer).toBe("mermaid-flowchart");
    expect(snapshot.source.importer.importedAt).toBe(
      "2026-08-18T00:00:00.000Z",
    );
  });

  it("persists renderer-neutral visual edits beside semantic entities", () => {
    const view = {
      hiddenEntityIds: [entityId("a")],
      groups: [
        {
          id: "visual-group-1",
          label: "Critical path",
          memberIds: [entityId("a")],
        },
      ],
      annotations: [
        {
          id: "annotation-1",
          entityId: entityId("a"),
          text: "Entry point",
        },
      ],
    };
    const snapshot = createGraphSnapshot({
      id: snapshotId("s"),
      source,
      entities: [{ kind: "node", id: entityId("a"), label: "A" }],
      view,
    });

    expect(snapshot).toHaveProperty("view", view);
    expect(snapshot.source.text).toBe("flowchart TD");
    expect(snapshot.entities[0]).not.toHaveProperty("hidden");
  });

  it("reports duplicate entity ids", () => {
    const snapshot = createGraphSnapshot({
      id: snapshotId("s"),
      source,
      entities: [
        { kind: "node", id: entityId("a"), label: "A" },
        { kind: "node", id: entityId("a"), label: "A again" },
      ],
    });
    const errors = validateGraphSnapshot(snapshot);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: "duplicate-entity-id",
      entityId: "a",
    });
    expect(errors[0].message).toContain("a");
  });

  it("reports edges, groups, and layout hints referencing unknown entities", () => {
    const snapshot = createGraphSnapshot({
      id: snapshotId("s"),
      source,
      entities: [
        {
          kind: "node",
          id: entityId("a"),
          label: "A",
          groupId: entityId("ghost-group"),
        },
        {
          kind: "edge",
          id: entityId("e"),
          source: entityId("a"),
          target: entityId("ghost-node"),
        },
        {
          kind: "group",
          id: entityId("g"),
          label: "G",
          memberIds: [entityId("ghost-member")],
        },
      ],
      layout: [{ entityId: entityId("ghost-layout"), x: 0, y: 0 }],
    });
    const codes = validateGraphSnapshot(snapshot)
      .map((e) => e.code)
      .sort();
    expect(codes).toEqual([
      "edge-missing-endpoint",
      "group-missing-member",
      "layout-missing-entity",
      "node-orphan-group",
    ]);
  });

  it.each([
    ["x", Number.NaN],
    ["y", Number.POSITIVE_INFINITY],
    ["width", Number.NEGATIVE_INFINITY],
    ["height", null],
  ] as const)("rejects an invalid layout %s value", (field, value) => {
    const snapshot = createGraphSnapshot({
      id: snapshotId("layout"),
      source,
      entities: [{ kind: "node", id: entityId("a"), label: "A" }],
      layout: [
        {
          entityId: entityId("a"),
          x: 0,
          y: 0,
          [field]: value,
        } as unknown as {
          entityId: ReturnType<typeof entityId>;
          x: number;
          y: number;
        },
      ],
    });

    expect(validateGraphSnapshot(snapshot)).toEqual([
      expect.objectContaining({ code: "non-finite-layout" }),
    ]);
  });

  it.each(["node", "edge"] as const)(
    "rejects a node groupId that resolves to a %s",
    (targetKind) => {
      const target =
        targetKind === "node"
          ? { kind: "node" as const, id: entityId("not-group"), label: "Node" }
          : {
              kind: "edge" as const,
              id: entityId("not-group"),
              source: entityId("member"),
              target: entityId("member"),
            };
      const snapshot = createGraphSnapshot({
        id: snapshotId("wrong-group-kind"),
        source,
        entities: [
          {
            kind: "node",
            id: entityId("member"),
            label: "Member",
            groupId: entityId("not-group"),
          },
          target,
        ],
      });

      expect(validateGraphSnapshot(snapshot)).toEqual([
        expect.objectContaining({ code: "node-group-kind-mismatch" }),
      ]);
    },
  );

  it("reports visual edits that reference unknown semantic entities", () => {
    const snapshot = createGraphSnapshot({
      id: snapshotId("s"),
      source,
      entities: [{ kind: "node", id: entityId("a"), label: "A" }],
      view: {
        hiddenEntityIds: [entityId("hidden-ghost")],
        groups: [
          {
            id: "visual-group",
            label: "Selection",
            memberIds: [entityId("group-ghost")],
          },
        ],
        annotations: [
          {
            id: "annotation",
            entityId: entityId("annotation-ghost"),
            text: "Missing target",
          },
        ],
      },
    });

    expect(
      validateGraphSnapshot(snapshot)
        .map((error) => error.code)
        .sort(),
    ).toEqual([
      "annotation-missing-entity",
      "visibility-missing-entity",
      "visual-group-missing-member",
    ]);
  });
});
