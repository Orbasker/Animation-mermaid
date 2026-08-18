import { describe, expect, it } from "vitest";

import { sampleProjectDocument } from "@/domain/fixtures";
import { createProjectDocument, projectId } from "@/domain/project-document";
import { createGraphSnapshot, entityId, snapshotId } from "@/domain/graph";
import { createStory, sceneId, storyId } from "@/domain/story";
import {
  buildExportPayload,
  ExportError,
  EXPORT_FORMAT_VERSION,
} from "@/export/export-payload";

const SAMPLE_STORY = storyId("story-walkthrough");

describe("buildExportPayload", () => {
  it("includes only the story's own snapshot and scenes", () => {
    const payload = buildExportPayload(sampleProjectDocument(), SAMPLE_STORY);

    expect(payload.snapshot.id).toBe("snap-current");
    expect(payload.story.id).toBe(SAMPLE_STORY);
    expect(payload.story.scenes).toHaveLength(3);
    expect(payload.snapshot.entities.some((entity) => entity.id === "client")).toBe(
      true,
    );
  });

  it("carries source attribution without private editor state", () => {
    const payload = buildExportPayload(sampleProjectDocument(), SAMPLE_STORY);

    expect(payload.meta.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(payload.meta.projectName).toBe("Sample architecture story");
    expect(payload.meta.diagramType).toBe("flowchart");
    expect(payload.meta.importer).toBe("mermaid-flowchart");
    expect(payload.meta.importerVersion).toBe("0.1.0");
    expect(payload.meta.importedAt).toBe("2026-08-18T00:00:00.000Z");
  });

  it("excludes other snapshots, stories, comparisons, and the raw source text", () => {
    const serialized = JSON.stringify(
      buildExportPayload(sampleProjectDocument(), SAMPLE_STORY),
    );

    // The proposed snapshot (and its unique `cache` node) must not leak.
    expect(serialized).not.toContain("snap-proposed");
    expect(serialized).not.toContain("cache");
    // No comparison payload.
    expect(serialized).not.toContain("cmp-current-vs-proposed");
    // No importer source text embedded (would carry the raw authored diagram).
    expect(serialized).not.toContain("flowchart TD");
    // No schema-version bookkeeping inside the embedded documents.
    expect(serialized).not.toContain("schemaVersion");
  });

  it("drops semantic node attributes the player never renders", () => {
    const payload = buildExportPayload(sampleProjectDocument(), SAMPLE_STORY);
    for (const entity of payload.snapshot.entities) {
      expect(entity).not.toHaveProperty("attributes");
    }
  });

  it("produces a per-scene static outline from the real engine", () => {
    const payload = buildExportPayload(sampleProjectDocument(), SAMPLE_STORY);

    expect(payload.outline).toHaveLength(3);
    expect(payload.outline[0].title).toBe("Client sends a request");
    expect(payload.outline[1].descriptions).toContain(
      "Orders Service: Processes the order",
    );
  });

  it("throws when the story is missing", () => {
    expect(() =>
      buildExportPayload(sampleProjectDocument(), storyId("nope")),
    ).toThrow(ExportError);
  });

  it("throws when the story has no scenes", () => {
    const snapshot = createGraphSnapshot({
      id: snapshotId("snap-empty"),
      source: {
        diagramType: "flowchart",
        text: "flowchart TD",
        importer: {
          importer: "mermaid-flowchart",
          importerVersion: "0.1.0",
          importedAt: "2026-08-18T00:00:00.000Z",
        },
      },
      entities: [{ kind: "node", id: entityId("a"), label: "A" }],
    });
    const project = createProjectDocument({
      id: projectId("proj-empty"),
      name: "Empty",
      snapshots: [snapshot],
      stories: [
        createStory({
          id: storyId("story-empty"),
          title: "Empty story",
          snapshotId: snapshot.id,
        }),
      ],
    });

    expect(() => buildExportPayload(project, storyId("story-empty"))).toThrow(
      /no scenes/,
    );
  });

  it("throws when the story references an unknown entity", () => {
    const snapshot = createGraphSnapshot({
      id: snapshotId("snap-x"),
      source: {
        diagramType: "flowchart",
        text: "flowchart TD",
        importer: {
          importer: "mermaid-flowchart",
          importerVersion: "0.1.0",
          importedAt: "2026-08-18T00:00:00.000Z",
        },
      },
      entities: [{ kind: "node", id: entityId("a"), label: "A" }],
    });
    const project = createProjectDocument({
      id: projectId("proj-x"),
      name: "Broken",
      snapshots: [snapshot],
      stories: [
        createStory({
          id: storyId("story-x"),
          title: "Broken story",
          snapshotId: snapshot.id,
          scenes: [
            {
              id: sceneId("scene-1"),
              title: "Reveal ghost",
              durationMs: 1000,
              actions: [{ type: "reveal", target: entityId("ghost") }],
            },
          ],
        }),
      ],
    });

    expect(() => buildExportPayload(project, storyId("story-x"))).toThrow(
      ExportError,
    );
  });
});
