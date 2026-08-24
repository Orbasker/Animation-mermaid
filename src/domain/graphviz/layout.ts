import type { GraphSnapshot, LayoutHint } from "@/domain/graph";
import { layoutFlowchart, type LayoutOptions } from "@/domain/mermaid/layout";
import type { GraphvizDirection } from "@/domain/graphviz/types";

/**
 * Lays a Graphviz snapshot out with the same deterministic ELK layered pass the flowchart
 * importer uses: DOT and flowchart both normalize to nodes, directed edges, and nested group
 * containers, so they share one renderer-neutral layout. `rankdir` (`TB`/`LR`/`BT`/`RL`) maps
 * straight onto the layout {@link import("@/domain/mermaid/types").Direction}. The snapshot's
 * source and entities are never touched — layout is derived data.
 */
export function layoutGraphviz(
  snapshot: GraphSnapshot,
  direction: GraphvizDirection = "TB",
  options: Omit<LayoutOptions, "direction"> = {},
): Promise<LayoutHint[]> {
  return layoutFlowchart(snapshot, { ...options, direction });
}
