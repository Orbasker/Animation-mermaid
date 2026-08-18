import type { ImporterCapabilities } from "@/domain/import/contract";
import {
  MERMAID_IMPORTER,
  MERMAID_IMPORTER_VERSION,
} from "@/domain/mermaid/import";

/** The `diagramType` written onto snapshots the flowchart importer produces. */
export const FLOWCHART_DIAGRAM_TYPE = "flowchart";

/**
 * Capability report for the flowchart importer. Kept in this leaf module — free of the ELK
 * layout dependency — so UI surfaces can render the report without pulling the layout engine
 * into their bundle.
 */
export const FLOWCHART_CAPABILITIES: ImporterCapabilities = {
  importer: MERMAID_IMPORTER,
  importerVersion: MERMAID_IMPORTER_VERSION,
  label: "Mermaid Flowchart",
  diagramType: FLOWCHART_DIAGRAM_TYPE,
  grammar: "mermaid",
  summary:
    "Nodes, directed edges, and nested subgraphs from `flowchart`/`graph` source.",
  features: [
    {
      name: "Node shapes",
      support: "full",
      detail: "Rectangles, rounds, cylinders, diamonds, hexagons, and more.",
    },
    {
      name: "Edges",
      support: "full",
      detail: "Solid/dotted/thick, labeled, and chained edges.",
    },
    { name: "Subgraphs", support: "full", detail: "Nested groups." },
    {
      name: "Multi-node edges (`&`)",
      support: "none",
      detail: "Reported; split into one edge per pair.",
    },
    {
      name: "Styling & interaction",
      support: "none",
      detail: "classDef/style/click are reported and ignored.",
    },
  ],
};
