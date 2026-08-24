import type { ImporterCapabilities } from "@/domain/import/contract";
import {
  GRAPHVIZ_DIAGRAM_TYPE,
  GRAPHVIZ_IMPORTER,
  GRAPHVIZ_IMPORTER_VERSION,
} from "@/domain/graphviz/import";

/**
 * Capability report for the Graphviz DOT importer. Kept in this leaf module — free of the ELK
 * layout dependency — so UI surfaces can render the report without pulling the layout engine into
 * their bundle.
 */
export const GRAPHVIZ_CAPABILITIES: ImporterCapabilities = {
  importer: GRAPHVIZ_IMPORTER,
  importerVersion: GRAPHVIZ_IMPORTER_VERSION,
  label: "Graphviz DOT",
  diagramType: GRAPHVIZ_DIAGRAM_TYPE,
  grammar: "graphviz",
  summary:
    "Nodes, directed/undirected edges, and `subgraph cluster_*` nested containers from `digraph`/`graph` DOT source.",
  features: [
    {
      name: "Nodes & attributes",
      support: "full",
      detail: "Ids, quoted labels, and `shape` carried onto each node.",
    },
    {
      name: "Edges",
      support: "full",
      detail: "`->`/`--`, chained, labeled, and dashed/dotted/bold styling.",
    },
    {
      name: "Clusters",
      support: "full",
      detail: "`subgraph cluster_*` become nested, drill-down containers.",
    },
    {
      name: "Non-cluster subgraphs",
      support: "partial",
      detail: "Flattened; their nodes import into the enclosing cluster.",
    },
    {
      name: "HTML labels, records & ports",
      support: "none",
      detail: "Reported and sanitized or dropped; the graph still imports.",
    },
  ],
};
