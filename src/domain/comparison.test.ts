import { describe, expect, it } from "vitest";

import {
  compareSnapshots,
  comparisonId,
  validateComparison,
  type Comparison,
  withIdentityMap,
} from "@/domain/comparison";
import { createGraphSnapshot, entityId, snapshotId } from "@/domain/graph";
import {
  confirmIdentity,
  EMPTY_IDENTITY_MAP,
  isConfirmed,
} from "@/domain/identity-map";
import {
  createProjectDocument,
  projectId,
  validateProjectDocument,
} from "@/domain/project-document";
import {
  parseProjectDocument,
  serializeProjectDocument,
} from "@/domain/serialization";
import {
  currentArchitectureSnapshot,
  proposedArchitectureSnapshot,
} from "@/domain/fixtures";

describe("compareSnapshots", () => {
  const current = currentArchitectureSnapshot();
  const proposed = proposedArchitectureSnapshot();

  it("detects added, removed, and modified entities semantically", () => {
    const cmp = compareSnapshots(comparisonId("c"), current, proposed);
    const byId = new Map(cmp.changes.map((c) => [c.entityId, c.op]));
    expect(byId.get(entityId("cache"))).toBe("added");
    expect(byId.get(entityId("cache->db"))).toBe("added");
    expect(byId.get(entityId("service->db"))).toBe("modified");
    expect(byId.has(entityId("client"))).toBe(false);
  });

  it("ignores layout-only differences", () => {
    const moved = createGraphSnapshot({
      id: snapshotId("moved"),
      source: current.source,
      entities: current.entities,
      layout: [{ entityId: entityId("client"), x: 999, y: 999 }],
    });
    const cmp = compareSnapshots(comparisonId("c"), current, moved);
    expect(cmp.changes).toEqual([]);
  });

  it("produces a comparison that validates against its snapshots", () => {
    const cmp = compareSnapshots(comparisonId("c"), current, proposed);
    expect(validateComparison(cmp, current, proposed)).toEqual([]);
  });

  it("flags snapshot-id mismatches", () => {
    const cmp = compareSnapshots(comparisonId("c"), current, proposed);
    const errors = validateComparison(cmp, proposed, current);
    const codes = errors.map((e) => e.code).sort();
    expect(codes).toContain("comparison-base-mismatch");
    expect(codes).toContain("comparison-target-mismatch");
  });

  it("validates canonical added, removed, and modified changes", () => {
    const forward = compareSnapshots(
      comparisonId("forward"),
      current,
      proposed,
    );
    const reverse = compareSnapshots(
      comparisonId("reverse"),
      proposed,
      current,
    );

    expect(forward.changes.map((change) => change.op)).toEqual([
      "added",
      "added",
      "modified",
    ]);
    expect(reverse.changes.map((change) => change.op)).toEqual([
      "removed",
      "removed",
      "modified",
    ]);
    expect(validateComparison(forward, current, proposed)).toEqual([]);
    expect(validateComparison(reverse, proposed, current)).toEqual([]);
  });

  it("compares semantic attributes independent of key insertion order", () => {
    const base = createGraphSnapshot({
      id: snapshotId("attributes-base"),
      source: current.source,
      entities: [
        {
          kind: "node",
          id: entityId("node"),
          label: "Node",
          attributes: { alpha: "1", beta: "2" },
        },
      ],
    });
    const target = createGraphSnapshot({
      id: snapshotId("attributes-target"),
      source: current.source,
      entities: [
        {
          kind: "node",
          id: entityId("node"),
          label: "Node",
          attributes: { beta: "2", alpha: "1" },
        },
      ],
    });

    expect(
      compareSnapshots(comparisonId("attributes"), base, target).changes,
    ).toEqual([]);
  });

  it.each([
    [
      "forged embedded id",
      (canonical: Comparison): Comparison => ({
        ...canonical,
        changes: canonical.changes.map((change, index) =>
          index === 0 && change.op === "added"
            ? { ...change, after: { ...change.after, id: entityId("forged") } }
            : change,
        ),
      }),
      "change-entity-id-mismatch",
    ],
    [
      "forged content",
      (canonical: Comparison): Comparison => ({
        ...canonical,
        changes: canonical.changes.map((change, index) =>
          index === 0 && change.op === "added" && change.after.kind === "node"
            ? { ...change, after: { ...change.after, label: "Forged" } }
            : change,
        ),
      }),
      "change-payload-mismatch",
    ],
    [
      "duplicate",
      (canonical: Comparison): Comparison => ({
        ...canonical,
        changes: [canonical.changes[0], ...canonical.changes],
      }),
      "duplicate-change-entity",
    ],
    [
      "omission",
      (canonical: Comparison): Comparison => ({
        ...canonical,
        changes: canonical.changes.slice(1),
      }),
      "missing-change",
    ],
    [
      "unexpected change",
      (canonical: Comparison): Comparison => ({
        ...canonical,
        changes: [
          ...canonical.changes,
          {
            op: "modified",
            entityId: entityId("client"),
            before: current.entities.find(
              (entity) => entity.id === entityId("client"),
            )!,
            after: proposed.entities.find(
              (entity) => entity.id === entityId("client"),
            )!,
          },
        ],
      }),
      "unexpected-change",
    ],
  ] as const)("rejects a %s comparison", (_, forge, expectedCode) => {
    const canonical = compareSnapshots(
      comparisonId("forged"),
      current,
      proposed,
    );
    expect(
      validateComparison(forge(canonical), current, proposed).map(
        (error) => error.code,
      ),
    ).toContain(expectedCode);
  });

  it("persists a confirmed identity map through serialization", () => {
    const map = confirmIdentity(
      EMPTY_IDENTITY_MAP,
      entityId("service"),
      entityId("orders"),
    );
    const cmp = withIdentityMap(
      compareSnapshots(comparisonId("cmp"), current, proposed),
      map,
    );
    const project = createProjectDocument({
      id: projectId("p"),
      name: "P",
      snapshots: [current, proposed],
      comparisons: [cmp],
    });
    expect(validateProjectDocument(project)).toEqual([]);

    const restored = parseProjectDocument(serializeProjectDocument(project));
    const restoredMap = restored.comparisons[0]?.identityMap;
    expect(restoredMap).toBeDefined();
    expect(
      restoredMap &&
        isConfirmed(restoredMap, entityId("service"), entityId("orders")),
    ).toBe(true);
  });
});
