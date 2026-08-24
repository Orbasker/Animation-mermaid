import { describe, expect, it } from "vitest";

import { snapshotId, type EntityId, type GraphSnapshot } from "@/domain/graph";
import { importMermaidFlowchart } from "@/domain/mermaid/import";

import {
  buildExplorerGraph,
  deriveVisibleGraph,
  initialExplorerState,
  toggleCollapse,
} from "@/explorer/explorer-model";
import { layoutVisibleGraph } from "@/explorer/explorer-layout";

const NESTED = `flowchart LR
  subgraph outer[Outer]
    subgraph inner[Inner]
      a[Alpha]
      d[Delta]
    end
    b[Beta]
  end
  c(Gamma)
  a --> b
  b --> c`;

function snapshotFrom(text: string): GraphSnapshot {
  const result = importMermaidFlowchart({
    text,
    snapshotId: snapshotId("layout-test"),
    importedAt: "1970-01-01T00:00:00.000Z",
  });
  if (!result.snapshot) throw new Error("fixture failed to import");
  return result.snapshot;
}

const id = (value: string) => value as EntityId;

function contains(
  outer: { x: number; y: number; width: number; height: number },
  inner: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

describe("layoutVisibleGraph", () => {
  it("nests child rects fully inside their container frame", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const view = deriveVisibleGraph(graph, initialExplorerState());
    const laid = layoutVisibleGraph(view);

    const outer = laid.containers.find((c) => c.id === "outer")!;
    const inner = laid.containers.find((c) => c.id === "inner")!;
    const alpha = laid.leaves.find((n) => n.id === "a")!;
    const beta = laid.leaves.find((n) => n.id === "b")!;

    expect(contains(outer.rect, inner.rect)).toBe(true);
    expect(contains(outer.rect, beta.rect)).toBe(true);
    expect(contains(inner.rect, alpha.rect)).toBe(true);
  });

  it("resolves edges to endpoint centres and drops those with no drawn endpoint", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const view = deriveVisibleGraph(graph, initialExplorerState());
    const laid = layoutVisibleGraph(view);

    const ab = laid.edges.find((e) => e.source === "a" && e.target === "b")!;
    const alpha = laid.leaves.find((n) => n.id === "a")!;
    expect(ab.from.x).toBeCloseTo(alpha.rect.x + alpha.rect.width / 2);
    expect(ab.from.y).toBeCloseTo(alpha.rect.y + alpha.rect.height / 2);
  });

  it("draws a collapsed container as a single positioned summary box", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const view = deriveVisibleGraph(
      graph,
      toggleCollapse(initialExplorerState(), id("inner")),
    );
    const laid = layoutVisibleGraph(view);

    expect(laid.leaves.some((n) => n.id === "inner")).toBe(true);
    expect(laid.leaves.some((n) => n.id === "a")).toBe(false);
    expect(laid.width).toBeGreaterThan(0);
    expect(laid.height).toBeGreaterThan(0);
  });
});
