import { CURRENT_SCHEMA_VERSION, type Versioned } from "@/domain/schema-version";

/**
 * Stable identifier for a graph element. IDs are assigned once when an element is first
 * parsed and never reused, so scene steps can reference elements even after the diagram
 * is re-parsed or re-laid-out.
 */
export type NodeId = string & { readonly __brand: "NodeId" };
export type EdgeId = string & { readonly __brand: "EdgeId" };
export type SubgraphId = string & { readonly __brand: "SubgraphId" };

export function nodeId(value: string): NodeId {
  return value as NodeId;
}

export function edgeId(value: string): EdgeId {
  return value as EdgeId;
}

export function subgraphId(value: string): SubgraphId {
  return value as SubgraphId;
}

/** A single node/vertex in the diagram. */
export interface GraphNode {
  readonly id: NodeId;
  /** Rendered text of the node, as authored in the Mermaid source. */
  readonly label: string;
  /** Optional subgraph this node belongs to. */
  readonly subgraphId?: SubgraphId;
}

/** A directed connection between two nodes. */
export interface GraphEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  /** Optional label rendered on the edge. */
  readonly label?: string;
}

/** A named grouping of nodes (Mermaid `subgraph`). */
export interface Subgraph {
  readonly id: SubgraphId;
  readonly label: string;
  readonly nodeIds: readonly NodeId[];
}

/**
 * The normalized, source-of-truth representation of a diagram: the original Mermaid
 * source plus its parsed structure. This describes *what* is animated; timing lives in
 * the {@link SceneDocument}.
 */
export interface ProjectGraph extends Versioned {
  /** The Mermaid diagram kind, e.g. "flowchart", "sequenceDiagram". */
  readonly diagramType: string;
  /** The raw Mermaid source the graph was parsed from. */
  readonly source: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly subgraphs: readonly Subgraph[];
}

export interface CreateProjectGraphInput {
  readonly diagramType: string;
  readonly source: string;
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly GraphEdge[];
  readonly subgraphs?: readonly Subgraph[];
}

/** Builds a {@link ProjectGraph} at the current schema version. */
export function createProjectGraph(input: CreateProjectGraphInput): ProjectGraph {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    diagramType: input.diagramType,
    source: input.source,
    nodes: input.nodes ?? [],
    edges: input.edges ?? [],
    subgraphs: input.subgraphs ?? [],
  };
}

export interface GraphValidationError {
  readonly code:
    | "duplicate-node-id"
    | "duplicate-edge-id"
    | "duplicate-subgraph-id"
    | "edge-missing-endpoint"
    | "subgraph-missing-node"
    | "node-orphan-subgraph";
  readonly message: string;
}

/**
 * Checks the referential integrity of a graph: unique IDs, edges pointing at existing
 * nodes, and subgraph membership pointing at existing nodes. Returns every problem found
 * rather than throwing, so callers can surface them together.
 */
export function validateProjectGraph(
  graph: ProjectGraph,
): readonly GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  const nodeIds = new Set<NodeId>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({
        code: "duplicate-node-id",
        message: `Duplicate node id: ${node.id}`,
      });
    }
    nodeIds.add(node.id);
  }

  const subgraphIds = new Set<SubgraphId>();
  for (const subgraph of graph.subgraphs) {
    if (subgraphIds.has(subgraph.id)) {
      errors.push({
        code: "duplicate-subgraph-id",
        message: `Duplicate subgraph id: ${subgraph.id}`,
      });
    }
    subgraphIds.add(subgraph.id);

    for (const memberId of subgraph.nodeIds) {
      if (!nodeIds.has(memberId)) {
        errors.push({
          code: "subgraph-missing-node",
          message: `Subgraph ${subgraph.id} references unknown node ${memberId}`,
        });
      }
    }
  }

  const edgeIds = new Set<EdgeId>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      errors.push({
        code: "duplicate-edge-id",
        message: `Duplicate edge id: ${edge.id}`,
      });
    }
    edgeIds.add(edge.id);

    for (const endpoint of [edge.source, edge.target]) {
      if (!nodeIds.has(endpoint)) {
        errors.push({
          code: "edge-missing-endpoint",
          message: `Edge ${edge.id} references unknown node ${endpoint}`,
        });
      }
    }
  }

  for (const node of graph.nodes) {
    if (node.subgraphId !== undefined && !subgraphIds.has(node.subgraphId)) {
      errors.push({
        code: "node-orphan-subgraph",
        message: `Node ${node.id} references unknown subgraph ${node.subgraphId}`,
      });
    }
  }

  return errors;
}
