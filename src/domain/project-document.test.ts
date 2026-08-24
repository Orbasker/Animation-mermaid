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
  it("round-trips a current-version project without semantic changes", () => {
    const project = sampleProjectDocument();
    const restored = parseProjectDocument(serializeProjectDocument(project));
    expect(restored).toEqual(project);
    expect(validateProjectDocument(restored)).toEqual([]);
  });

  it("migrates a version-1 project and then round-trips version 2", () => {
    const current = sampleProjectDocument();
    const legacy = {
      ...current,
      schemaVersion: 1,
      snapshots: current.snapshots.map((snapshot) => ({
        ...snapshot,
        schemaVersion: 1,
      })),
      stories: current.stories.map((story) => ({
        ...story,
        schemaVersion: 1,
      })),
    };

    const migrated = parseProjectDocument(JSON.stringify(legacy));
    const restored = parseProjectDocument(serializeProjectDocument(migrated));

    expect(restored).toEqual(migrated);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.snapshots.every((item) => item.schemaVersion === 2)).toBe(
      true,
    );
    expect(migrated.stories.every((item) => item.schemaVersion === 2)).toBe(
      true,
    );
  });

  it("rejects a payload that is not a JSON object", () => {
    expect(() => parseProjectDocument("[]")).toThrow(/expected a JSON object/);
  });

  it("rejects an unsupported schema version on parse", () => {
    const bad = JSON.stringify({
      ...sampleProjectDocument(),
      schemaVersion: 99,
    });
    expect(() => parseProjectDocument(bad)).toThrow(
      /unsupported schemaVersion/i,
    );
  });

  it("rejects non-finite transforms instead of serializing them as null", () => {
    const snapshot = currentArchitectureSnapshot();
    const project = createProjectDocument({
      id: projectId("non-finite"),
      name: "Non-finite",
      snapshots: [snapshot],
      stories: [
        createStory({
          id: storyId("non-finite"),
          title: "Non-finite",
          snapshotId: snapshot.id,
          scenes: [
            {
              id: sceneId("transform"),
              title: "Transform",
              durationMs: 100,
              actions: [
                {
                  type: "transform",
                  target: entityId("client"),
                  to: {
                    translateX: Number.POSITIVE_INFINITY,
                    translateY: 0,
                    scale: 1,
                    rotateDeg: 0,
                  },
                },
              ],
            },
          ],
        }),
      ],
    });

    expect(() => serializeProjectDocument(project)).toThrow(
      /non-finite transform/i,
    );
  });

  it("rejects persisted transform nulls at the parse boundary", () => {
    const project = sampleProjectDocument();
    const persisted = {
      ...project,
      stories: [
        {
          ...project.stories[0],
          scenes: [
            {
              ...project.stories[0].scenes[0],
              actions: [
                {
                  type: "transform",
                  target: "client",
                  to: null,
                },
              ],
            },
          ],
        },
      ],
    };

    expect(() => parseProjectDocument(JSON.stringify(persisted))).toThrow(
      /actions\[0\]\.to.*object/i,
    );
  });

  it("requires current nested schema versions on parse and serialization", () => {
    const project = sampleProjectDocument();
    const stale = {
      ...project,
      stories: [{ ...project.stories[0], schemaVersion: 1 as const }],
    };

    expect(() => parseProjectDocument(JSON.stringify(stale))).toThrow(
      /stories\[0\]\.schemaVersion.*2/i,
    );
    expect(() => serializeProjectDocument(stale)).toThrow(
      /stories\[0\]\.schemaVersion.*2/i,
    );
  });

  it("rejects non-finite layouts on serialization and persisted null layouts on parse", () => {
    const project = sampleProjectDocument();
    const snapshot = project.snapshots[0];
    const invalidNumber = {
      ...project,
      snapshots: [
        {
          ...snapshot,
          layout: [{ entityId: entityId("client"), x: Number.NaN, y: 0 }],
        },
        ...project.snapshots.slice(1),
      ],
    };
    const persistedNull = {
      ...project,
      snapshots: [
        {
          ...snapshot,
          layout: [{ entityId: entityId("client"), x: null, y: 0 }],
        },
        ...project.snapshots.slice(1),
      ],
    };

    expect(() => serializeProjectDocument(invalidNumber)).toThrow(
      /layout.*x.*finite/i,
    );
    expect(() => parseProjectDocument(JSON.stringify(persistedNull))).toThrow(
      /snapshots\[0\]\.layout\[0\]\.x.*number/i,
    );
  });

  it.each([
    ["missing snapshots", { snapshots: undefined }],
    ["non-array stories", { stories: "stories" }],
  ])("rejects a structurally malformed project with %s", (_, replacement) => {
    const malformed = { ...sampleProjectDocument(), ...replacement };
    expect(() => parseProjectDocument(JSON.stringify(malformed))).toThrow(
      /project\.(snapshots|stories).*array/i,
    );
  });

  it.each([
    ["reveal", { type: "reveal" }],
    ["hide", { type: "hide", target: 1 }],
    ["focus", { type: "focus", target: null }],
    ["trace", { type: "trace", target: [] }],
    ["transform", { type: "transform", target: "client", to: null }],
    ["compare", { type: "compare", target: "client", change: "same" }],
    ["highlight", { type: "highlight", target: "client", style: 1 }],
    ["annotate", { type: "annotate", target: "client" }],
    ["camera", { type: "camera", focus: [1] }],
    ["unknown", { type: "explode", target: "client" }],
  ])("rejects a malformed %s action with a controlled path", (_, action) => {
    const project = sampleProjectDocument();
    const story = project.stories[0];
    const scene = story.scenes[0];
    const malformed = {
      ...project,
      stories: [
        {
          ...story,
          scenes: [{ ...scene, actions: [action] }, ...story.scenes.slice(1)],
        },
      ],
    };

    expect(() => parseProjectDocument(JSON.stringify(malformed))).toThrow(
      /stories\[0\]\.scenes\[0\]\.actions\[0\]/i,
    );
  });

  it("accepts every valid action discriminant through structural decoding", () => {
    const project = sampleProjectDocument();
    const story = project.stories[0];
    const scene = story.scenes[0];
    const allActions = {
      ...project,
      stories: [
        {
          ...story,
          scenes: [
            {
              ...scene,
              actions: [
                { type: "reveal", target: "client" },
                { type: "hide", target: "db" },
                { type: "focus", target: "api" },
                { type: "trace", target: "client->api" },
                {
                  type: "transform",
                  target: "service",
                  to: {
                    translateX: 1,
                    translateY: 2,
                    scale: 1.2,
                    rotateDeg: 3,
                  },
                },
                { type: "compare", target: "db", change: "modified" },
                { type: "highlight", target: "backend", style: "active" },
                { type: "annotate", target: "api->service", text: "Request" },
                { type: "camera", focus: ["client", "api"] },
              ],
            },
            ...story.scenes.slice(1),
          ],
        },
      ],
    };

    const restored = parseProjectDocument(JSON.stringify(allActions));
    expect(
      restored.stories[0].scenes[0].actions.map((action) => action.type),
    ).toEqual([
      "reveal",
      "hide",
      "focus",
      "trace",
      "transform",
      "compare",
      "highlight",
      "annotate",
      "camera",
    ]);
  });

  it.each([
    [
      "graph entity",
      (project: ReturnType<typeof sampleProjectDocument>) => ({
        ...project,
        snapshots: [
          {
            ...project.snapshots[0],
            entities: [{ kind: "widget", id: "widget" }],
          },
          ...project.snapshots.slice(1),
        ],
      }),
    ],
    [
      "scene actions",
      (project: ReturnType<typeof sampleProjectDocument>) => ({
        ...project,
        stories: [
          {
            ...project.stories[0],
            scenes: [{ ...project.stories[0].scenes[0], actions: "actions" }],
          },
        ],
      }),
    ],
  ] as const)("rejects a malformed nested %s", (_, malformedProject) => {
    expect(() =>
      parseProjectDocument(
        JSON.stringify(malformedProject(sampleProjectDocument())),
      ),
    ).toThrow(/project\.(snapshots|stories)/i);
  });

  it("rejects node groupId references to a non-group on parse and serialization", () => {
    const project = sampleProjectDocument();
    const snapshot = project.snapshots[0];
    const invalid = {
      ...project,
      snapshots: [
        {
          ...snapshot,
          entities: snapshot.entities.map((entity) =>
            entity.kind === "node" && entity.id === entityId("client")
              ? { ...entity, groupId: entityId("api") }
              : entity,
          ),
        },
        ...project.snapshots.slice(1),
      ],
    };

    expect(() => serializeProjectDocument(invalid)).toThrow(
      /groupId.*api.*not a group/i,
    );
    expect(() => parseProjectDocument(JSON.stringify(invalid))).toThrow(
      /groupId.*api.*not a group/i,
    );
  });
});
