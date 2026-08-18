import { describe, expect, it } from "vitest";

import { createStressSnapshot } from "@/domain/editor";
import { sampleProjectDocument } from "@/domain/fixtures";
import { createProjectDocument, projectId } from "@/domain/project-document";
import { serializeProjectDocument } from "@/domain/serialization";

/**
 * Export-size budgets for the portable JSON a project exports. The document is the whole
 * shareable artifact, so its size is a first-class property: a regression that starts embedding
 * layout noise or duplicating snapshots would show up as a step change here long before a user
 * notices a bloated download. Budgets sit at roughly 1.5× the current size — tight enough to
 * catch a real regression, loose enough to absorb ordinary content growth.
 */

function exportBytes(document: Parameters<typeof serializeProjectDocument>[0]): number {
  return Buffer.byteLength(serializeProjectDocument(document), "utf8");
}

describe("portable export size", () => {
  it("keeps the sample project export small", () => {
    expect(exportBytes(sampleProjectDocument())).toBeLessThan(6_000);
  });

  it("keeps a 200-component export within budget", () => {
    const dense = createProjectDocument({
      id: projectId("proj-stress"),
      name: "Dense architecture",
      snapshots: [createStressSnapshot(200)],
    });
    expect(exportBytes(dense)).toBeLessThan(80_000);
  });
});
