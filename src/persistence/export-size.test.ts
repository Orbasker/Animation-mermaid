import { describe, expect, it } from "vitest";

import { createStressSnapshot } from "@/domain/editor";
import { sampleProjectDocument } from "@/domain/fixtures";
import { createProjectDocument, projectId } from "@/domain/project-document";
import { serializeProjectDocument } from "@/domain/serialization";
import budgets from "../../tools/performance-budgets.json";

function exportBytes(
  document: Parameters<typeof serializeProjectDocument>[0],
): number {
  return Buffer.byteLength(serializeProjectDocument(document), "utf8");
}

describe("portable export size", () => {
  it("keeps the sample project export small", () => {
    expect(exportBytes(sampleProjectDocument())).toBeLessThanOrEqual(
      budgets.export.sampleProjectJsonBytes,
    );
  });

  it("keeps a 200-component export within budget", () => {
    const dense = createProjectDocument({
      id: projectId("proj-stress"),
      name: "Dense architecture",
      snapshots: [createStressSnapshot(200)],
    });
    expect(exportBytes(dense)).toBeLessThanOrEqual(
      budgets.export.denseProjectJsonBytes,
    );
  });
});
