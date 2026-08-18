import { describe, expect, it } from "vitest";

import {
  createProjectDocument,
  projectId,
  validateProjectDocument,
} from "@/domain/project-document";
import { createStory, sceneId, storyId } from "@/domain/story";
import { entityId, snapshotId } from "@/domain/graph";
import {
  parseProjectDocument,
  serializeProjectDocument,
} from "@/domain/serialization";
import {
  currentArchitectureSnapshot,
  sampleProjectDocument,
} from "@/domain/fixtures";

describe("validateProjectDocument", () => {
  it("accepts a representative project fixture", () => {
    expect(validateProjectDocument(sampleProjectDocument())).toEqual([]);
  });

  it("fails invalid references with actionable, scoped errors", () => {
    const project = createProjectDocument({
      id: projectId("p"),
      name: "broken",
      snapshots: [currentArchitectureSnapshot()],
      stories: [
        createStory({
          id: storyId("story-a"),
          title: "targets a missing snapshot",
          snapshotId: snapshotId("does-not-exist"),
          scenes: [
            {
              id: sceneId("s"),
              title: "s",
              durationMs: 1,
              actions: [{ type: "reveal", target: entityId("client") }],
            },
          ],
        }),
      ],
    });
    const errors = validateProjectDocument(project);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      scope: "story",
      code: "story-missing-snapshot",
    });
    expect(errors[0].message).toContain("does-not-exist");
  });

  it("surfaces per-scene action errors against the targeted snapshot", () => {
    const snapshot = currentArchitectureSnapshot();
    const project = createProjectDocument({
      id: projectId("p"),
      name: "broken story",
      snapshots: [snapshot],
      stories: [
        createStory({
          id: storyId("story-a"),
          title: "bad action",
          snapshotId: snapshot.id,
          scenes: [
            {
              id: sceneId("s"),
              title: "s",
              durationMs: 1,
              actions: [{ type: "reveal", target: entityId("nope") }],
            },
          ],
        }),
      ],
    });
    const errors = validateProjectDocument(project);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("action-missing-entity");
    expect(errors[0].message).toContain("nope");
  });
});

describe("scene data is renderer-neutral", () => {
  it("references entities only by string id — no renderer objects", () => {
    const story = sampleProjectDocument().stories[0];
    for (const scene of story.scenes) {
      for (const action of scene.actions) {
        if (action.type === "camera") {
          for (const focus of action.focus) {
            expect(typeof focus).toBe("string");
          }
        } else {
          expect(typeof action.target).toBe("string");
        }
      }
    }
    const serialized = JSON.stringify(story);
    expect(serialized).not.toMatch(/reactflow|svg|d3|__proto|position/i);
  });
});

describe("serialization round-trip", () => {
  it("round-trips a version-1 project without semantic changes", () => {
    const project = sampleProjectDocument();
    const restored = parseProjectDocument(serializeProjectDocument(project));
    expect(restored).toEqual(project);
    expect(validateProjectDocument(restored)).toEqual([]);
  });

  it("rejects a payload that is not a JSON object", () => {
    expect(() => parseProjectDocument("[]")).toThrow(/expected a JSON object/);
  });

  it("rejects an unsupported schema version on parse", () => {
    const bad = JSON.stringify({ ...sampleProjectDocument(), schemaVersion: 99 });
    expect(() => parseProjectDocument(bad)).toThrow(/unsupported schemaVersion/i);
  });
});
