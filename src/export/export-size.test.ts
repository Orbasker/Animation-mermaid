import { describe, expect, it } from "vitest";

import { sampleProjectDocument } from "@/domain/fixtures";
import { createProjectDocument, projectId } from "@/domain/project-document";
import { createStressSnapshot } from "@/domain/editor";
import { createStory, sceneId, storyId } from "@/domain/story";
import type { EntityId } from "@/domain/graph";
import { buildExportPayload } from "@/export/export-payload";
import { buildExportHtml } from "@/export/export-html";
import budgets from "../../tools/performance-budgets.json";

function exportBytes(html: string): number {
  return Buffer.byteLength(html, "utf8");
}

function denseStoryProject() {
  const snapshot = createStressSnapshot(200);
  const nodeIds = snapshot.entities
    .filter((entity) => entity.kind === "node")
    .slice(0, 60)
    .map((entity) => entity.id as EntityId);
  const scenes = Array.from({ length: 10 }, (_, index) => ({
    id: sceneId(`scene-${index}`),
    title: `Scene ${index + 1}`,
    durationMs: 1000,
    actions: nodeIds
      .slice(index * 6, index * 6 + 6)
      .map((target) => ({ type: "reveal" as const, target })),
  }));

  return createProjectDocument({
    id: projectId("proj-dense"),
    name: "Dense architecture",
    snapshots: [snapshot],
    stories: [
      createStory({
        id: storyId("story-dense"),
        title: "Dense walkthrough",
        snapshotId: snapshot.id,
        scenes,
      }),
    ],
  });
}

describe("self-contained export size", () => {
  it("keeps the sample story export small", () => {
    const html = buildExportHtml(
      buildExportPayload(sampleProjectDocument(), storyId("story-walkthrough")),
    );
    expect(exportBytes(html)).toBeLessThanOrEqual(
      budgets.export.sampleHtmlBytes,
    );
  });

  it("keeps a 200-node, 10-scene export within budget", () => {
    const html = buildExportHtml(
      buildExportPayload(denseStoryProject(), storyId("story-dense")),
    );
    expect(exportBytes(html)).toBeLessThanOrEqual(
      budgets.export.denseHtmlBytes,
    );
  });
});
