import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION } from "@/domain/schema-version";
import {
  createProjectGraph,
  edgeId,
  nodeId,
  subgraphId,
  validateProjectGraph,
  type GraphEdge,
  type GraphNode,
  type Subgraph,
} from "@/domain/project-graph";

const nodeA: GraphNode = { id: nodeId("a"), label: "A" };
const nodeB: GraphNode = { id: nodeId("b"), label: "B" };
const edgeAB: GraphEdge = {
  id: edgeId("a->b"),
  source: nodeId("a"),
  target: nodeId("b"),
};

describe("createProjectGraph", () => {
  it("stamps the current schema version and defaults collections to empty", () => {
    const graph = createProjectGraph({ diagramType: "flowchart", source: "graph TD" });

    expect(graph.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.subgraphs).toEqual([]);
  });
});

describe("validateProjectGraph", () => {
  it("accepts a referentially sound graph", () => {
    const subgraph: Subgraph = {
      id: subgraphId("g1"),
      label: "Group",
      nodeIds: [nodeId("a")],
    };
    const graph = createProjectGraph({
      diagramType: "flowchart",
      source: "graph TD",
      nodes: [{ ...nodeA, subgraphId: subgraphId("g1") }, nodeB],
      edges: [edgeAB],
      subgraphs: [subgraph],
    });

    expect(validateProjectGraph(graph)).toEqual([]);
  });

  it("flags duplicate node ids", () => {
    const graph = createProjectGraph({
      diagramType: "flowchart",
      source: "graph TD",
      nodes: [nodeA, nodeA],
    });

    expect(validateProjectGraph(graph)).toContainEqual(
      expect.objectContaining({ code: "duplicate-node-id" }),
    );
  });

  it("flags edges pointing at missing nodes", () => {
    const graph = createProjectGraph({
      diagramType: "flowchart",
      source: "graph TD",
      nodes: [nodeA],
      edges: [edgeAB],
    });

    expect(validateProjectGraph(graph)).toContainEqual(
      expect.objectContaining({ code: "edge-missing-endpoint" }),
    );
  });

  it("flags subgraph membership and node references to missing subgraphs", () => {
    const graph = createProjectGraph({
      diagramType: "flowchart",
      source: "graph TD",
      nodes: [{ ...nodeA, subgraphId: subgraphId("ghost") }],
      subgraphs: [
        { id: subgraphId("g1"), label: "Group", nodeIds: [nodeId("missing")] },
      ],
    });

    const codes = validateProjectGraph(graph).map((error) => error.code);
    expect(codes).toContain("subgraph-missing-node");
    expect(codes).toContain("node-orphan-subgraph");
  });
});
