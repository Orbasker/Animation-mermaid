import { describe, expect, it } from "vitest";

import { snapshotId } from "@/domain/graph";
import { importGraphvizDot } from "@/domain/graphviz/import";
import { layoutGraphviz } from "@/domain/graphviz/layout";
import { ACCEPTANCE_DOT } from "@/domain/graphviz/fixtures";

const IMPORTED_AT = "2026-08-24T00:00:00.000Z";

describe("layoutGraphviz", () => {
  const snapshot = importGraphvizDot({
    text: ACCEPTANCE_DOT,
    snapshotId: snapshotId("snap-dot"),
    importedAt: IMPORTED_AT,
  }).snapshot!;

  it("positions every node and cluster with finite coordinates", async () => {
    const hints = await layoutGraphviz(snapshot, "TB");
    const positioned = new Set(hints.map((h) => h.entityId as string));
    for (const id of ["client", "api", "service", "db", "cluster_backend"]) {
      expect(positioned.has(id)).toBe(true);
    }
    for (const hint of hints) {
      expect(Number.isFinite(hint.x)).toBe(true);
      expect(Number.isFinite(hint.y)).toBe(true);
    }
  });

  it("is deterministic for the same snapshot", async () => {
    const a = await layoutGraphviz(snapshot, "TB");
    const b = await layoutGraphviz(snapshot, "TB");
    expect(a).toEqual(b);
  });
});
