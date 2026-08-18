import { describe, expect, it } from "vitest";

import {
  compareSnapshots,
  comparisonId,
  validateComparison,
  withIdentityMap,
} from "@/domain/comparison";
import {
  createGraphSnapshot,
  entityId,
  snapshotId,
} from "@/domain/graph";
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
      restoredMap && isConfirmed(restoredMap, entityId("service"), entityId("orders")),
    ).toBe(true);
  });
});
