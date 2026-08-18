import { describe, expect, it } from "vitest";

import { snapshotId } from "@/domain/graph";

import { previewMermaidImport, runMermaidImport } from "./run-import";

describe("previewMermaidImport", () => {
  it("reports counts for a valid flowchart", () => {
    const preview = previewMermaidImport(
      "flowchart LR\n  subgraph g[Group]\n    a[Service]\n  end\n  a --> b[(Database)]",
    );
    expect(preview.fatal).toBe(false);
    expect(preview.ok).toBe(true);
    expect(preview.nodeCount).toBe(2);
    expect(preview.edgeCount).toBe(1);
    expect(preview.groupCount).toBe(1);
  });

  it("treats blank input as fatal with no diagnostics", () => {
    const preview = previewMermaidImport("   \n  ");
    expect(preview.fatal).toBe(true);
    expect(preview.diagnostics).toHaveLength(0);
  });

  it("flags a non-flowchart as fatal with an error diagnostic", () => {
    const preview = previewMermaidImport("sequenceDiagram\n A->>B: hi");
    expect(preview.fatal).toBe(true);
    expect(preview.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });
});

describe("runMermaidImport", () => {
  it("attaches a deterministic layout to the imported snapshot", async () => {
    const run = await runMermaidImport({
      text: "flowchart LR\n a[Service] --> b[(Database)]",
      snapshotId: snapshotId("s1"),
      importedAt: "2026-08-18T00:00:00.000Z",
    });
    expect(run.snapshot).not.toBeNull();
    expect(run.snapshot!.id).toBe("s1");
    expect(run.snapshot!.layout?.length).toBe(2);
  });

  it("returns a null snapshot for fatal input", async () => {
    const run = await runMermaidImport({
      text: "not a diagram",
      snapshotId: snapshotId("s1"),
      importedAt: "2026-08-18T00:00:00.000Z",
    });
    expect(run.snapshot).toBeNull();
  });
});
