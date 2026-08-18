import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION } from "@/domain/schema-version";
import { createProjectGraph, edgeId, nodeId } from "@/domain/project-graph";
import { createSceneDocument, sceneId, stepId } from "@/domain/scene-document";
import {
  createProject,
  createProjectFromSource,
  validateProject,
} from "@/domain/project";

describe("createProject", () => {
  it("stamps the current schema version and defaults to an empty scene document", () => {
    const project = createProject({
      name: "Demo",
      graph: createProjectGraph({ diagramType: "flowchart", source: "graph TD" }),
    });

    expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(project.scenes.scenes).toEqual([]);
  });
});

describe("createProjectFromSource", () => {
  it("produces a valid empty project", () => {
    const project = createProjectFromSource({
      name: "Demo",
      diagramType: "flowchart",
      source: "graph TD\n a --> b",
    });

    expect(validateProject(project)).toEqual([]);
  });
});

describe("validateProject", () => {
  it("tags graph and scene errors with their scope", () => {
    const project = createProject({
      name: "Broken",
      graph: createProjectGraph({
        diagramType: "flowchart",
        source: "graph TD",
        nodes: [{ id: nodeId("a"), label: "A" }],
        edges: [{ id: edgeId("a->b"), source: nodeId("a"), target: nodeId("b") }],
      }),
      scenes: createSceneDocument({
        scenes: [
          {
            id: sceneId("s1"),
            title: "Intro",
            steps: [
              {
                id: stepId("step1"),
                durationMs: 100,
                actions: [
                  { type: "reveal", target: { kind: "node", id: nodeId("ghost") } },
                ],
              },
            ],
          },
        ],
      }),
    });

    const scopes = validateProject(project).map((error) => error.scope);
    expect(scopes).toContain("graph");
    expect(scopes).toContain("scenes");
  });
});
