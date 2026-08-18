import { describe, expect, it } from "vitest";

import {
  compareSnapshots,
  comparisonId,
  validateComparison,
} from "@/domain/comparison";
import {
  createGraphSnapshot,
  entityId,
  snapshotId,
} from "@/domain/graph";
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
});
