import { describe, expect, it } from "vitest";

import { entityId, snapshotId } from "@/domain/graph";
import { ACCEPTANCE_FLOWCHART } from "@/domain/mermaid/fixtures";
import { importMermaidFlowchart } from "@/domain/mermaid/import";
import { layoutFlowchart, mergeLayoutOverrides } from "@/domain/mermaid/layout";

function importedSnapshot() {
  return importMermaidFlowchart({
    text: ACCEPTANCE_FLOWCHART,
    snapshotId: snapshotId("snap-current"),
    importedAt: "2026-08-18T00:00:00.000Z",
  }).snapshot!;
}

describe("layoutFlowchart", () => {
  it("positions every node and group", async () => {
    const snapshot = importedSnapshot();
    const hints = await layoutFlowchart(snapshot, { direction: "TD" });
    const positioned = new Set(hints.map((h) => h.entityId as string));
    for (const id of ["client", "api", "service", "db", "backend"]) {
      expect(positioned.has(id)).toBe(true);
    }
    for (const hint of hints) {
      expect(Number.isFinite(hint.x)).toBe(true);
      expect(Number.isFinite(hint.y)).toBe(true);
    }
  });

  it("is deterministic across runs", async () => {
    const snapshot = importedSnapshot();
    const a = await layoutFlowchart(snapshot, { direction: "TD" });
    const b = await layoutFlowchart(snapshot, { direction: "TD" });
    expect(a).toEqual(b);
  });

  it("keeps grouped nodes inside their group bounds", async () => {
    const snapshot = importedSnapshot();
    const hints = await layoutFlowchart(snapshot, { direction: "TD" });
    const byId = new Map(hints.map((h) => [h.entityId as string, h]));
    const backend = byId.get("backend")!;
    const api = byId.get("api")!;
    expect(api.x).toBeGreaterThanOrEqual(backend.x);
    expect(api.y).toBeGreaterThanOrEqual(backend.y);
  });
});

describe("mergeLayoutOverrides", () => {
  it("replaces only the position of overridden entities", async () => {
    const snapshot = importedSnapshot();
    const base = await layoutFlowchart(snapshot, { direction: "TD" });
    const merged = mergeLayoutOverrides(base, [
      { entityId: entityId("client"), x: 999, y: 888 },
    ]);

    const client = merged.find((h) => h.entityId === "client")!;
    expect(client).toMatchObject({ x: 999, y: 888 });

    const untouched = merged.filter((h) => h.entityId !== "client");
    expect(untouched).toEqual(base.filter((h) => h.entityId !== "client"));
  });

  it("does not mutate the base layout", async () => {
    const snapshot = importedSnapshot();
    const base = await layoutFlowchart(snapshot, { direction: "TD" });
    const snapshotOfBase = JSON.parse(JSON.stringify(base));
    mergeLayoutOverrides(base, [{ entityId: entityId("client"), x: 1, y: 2 }]);
    expect(base).toEqual(snapshotOfBase);
  });

  it("appends overrides for entities absent from the base", () => {
    const merged = mergeLayoutOverrides(
      [{ entityId: entityId("a"), x: 0, y: 0 }],
      [{ entityId: entityId("ghost"), x: 5, y: 6 }],
    );
    expect(merged).toContainEqual({ entityId: "ghost", x: 5, y: 6 });
  });
});
