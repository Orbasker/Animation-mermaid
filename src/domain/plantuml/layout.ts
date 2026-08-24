import type { GraphSnapshot, LayoutHint } from "@/domain/graph";
import { layoutFlowchart } from "@/domain/mermaid/layout";

/**
 * Lays a PlantUML snapshot out with the shared ELK layered engine. PlantUML containers are
 * modeled with the same `groupId`/{@link GroupEntity} shape as Mermaid subgraphs, so the
 * existing engine nests them without any PlantUML-specific code. Top-down mirrors PlantUML's
 * default vertical flow for class and component diagrams. Layout is derived data — the
 * snapshot's source and entities are never touched.
 */
export function layoutPlantuml(
  snapshot: GraphSnapshot,
): Promise<readonly LayoutHint[]> {
  return layoutFlowchart(snapshot, { direction: "TD" });
}
