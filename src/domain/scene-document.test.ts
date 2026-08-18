import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION } from "@/domain/schema-version";
import {
  createProjectGraph,
  edgeId,
  nodeId,
  type ProjectGraph,
} from "@/domain/project-graph";
import {
  ACTION_TYPES,
  createSceneDocument,
  sceneId,
  stepId,
  validateSceneDocument,
  type Action,
  type Scene,
} from "@/domain/scene-document";

const graph: ProjectGraph = createProjectGraph({
  diagramType: "flowchart",
  source: "graph TD",
  nodes: [
    { id: nodeId("a"), label: "A" },
    { id: nodeId("b"), label: "B" },
  ],
  edges: [{ id: edgeId("a->b"), source: nodeId("a"), target: nodeId("b") }],
});

function scene(actions: readonly Action[], durationMs = 500): Scene {
  return {
    id: sceneId("s1"),
    title: "Intro",
    steps: [{ id: stepId("step1"), durationMs, actions }],
  };
}

describe("createSceneDocument", () => {
  it("stamps the current schema version and defaults to no scenes", () => {
    const document = createSceneDocument();
    expect(document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(document.scenes).toEqual([]);
  });
});

describe("ACTION_TYPES", () => {
  it("lists every action type exactly once", () => {
    expect(new Set(ACTION_TYPES).size).toBe(ACTION_TYPES.length);
    expect(ACTION_TYPES).toContain("camera");
  });
});

describe("validateSceneDocument", () => {
  it("accepts steps that reference existing elements", () => {
    const document = createSceneDocument({
      scenes: [
        scene([
          { type: "reveal", target: { kind: "node", id: nodeId("a") } },
          { type: "highlight", target: { kind: "edge", id: edgeId("a->b") } },
          {
            type: "camera",
            focus: [{ kind: "node", id: nodeId("b") }],
          },
        ]),
      ],
    });

    expect(validateSceneDocument(document, graph)).toEqual([]);
  });

  it("flags actions referencing unknown elements", () => {
    const document = createSceneDocument({
      scenes: [
        scene([{ type: "reveal", target: { kind: "node", id: nodeId("ghost") } }]),
      ],
    });

    expect(validateSceneDocument(document, graph)).toContainEqual(
      expect.objectContaining({ code: "action-missing-element" }),
    );
  });

  it("flags negative durations", () => {
    const document = createSceneDocument({
      scenes: [scene([], -1)],
    });

    expect(validateSceneDocument(document, graph)).toContainEqual(
      expect.objectContaining({ code: "negative-duration" }),
    );
  });

  it("flags duplicate scene and step ids", () => {
    const one = scene([]);
    const document = createSceneDocument({ scenes: [one, one] });

    const codes = validateSceneDocument(document, graph).map((error) => error.code);
    expect(codes).toContain("duplicate-scene-id");
    expect(codes).toContain("duplicate-step-id");
  });
});
