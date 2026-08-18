import { describe, expect, it } from "vitest";

import { snapshotId } from "@/domain/graph";
import { ACCEPTANCE_SEQUENCE } from "@/domain/mermaid/sequence/fixtures";
import { importMermaidSequence } from "@/domain/mermaid/sequence/import";
import { layoutSequence } from "@/domain/mermaid/sequence/layout";

function snapshot() {
  return importMermaidSequence({
    text: ACCEPTANCE_SEQUENCE,
    snapshotId: snapshotId("snap-seq"),
    importedAt: "2026-08-18T00:00:00.000Z",
  }).snapshot!;
}

describe("layoutSequence", () => {
  it("lays participants out in declaration order as horizontal lanes", async () => {
    const hints = await layoutSequence(snapshot());
    expect(hints.map((h) => h.entityId)).toEqual([
      "client",
      "api",
      "service",
      "db",
    ]);
    expect(hints.map((h) => h.y)).toEqual([0, 0, 0, 0]);
    const xs = hints.map((h) => h.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it("emits no hints for messages (edges), only participants", async () => {
    const hints = await layoutSequence(snapshot());
    expect(hints).toHaveLength(4);
  });

  it("is deterministic for the same snapshot", async () => {
    const a = await layoutSequence(snapshot());
    const b = await layoutSequence(snapshot());
    expect(a).toEqual(b);
  });
});
