import { describe, expect, it } from "vitest";

import { snapshotId, type EntityId, type GraphSnapshot } from "@/domain/graph";
import { importMermaidFlowchart } from "@/domain/mermaid/import";

import {
  ancestorsOf,
  breadcrumbTrail,
  buildExplorerGraph,
  collapseAll,
  currentDrillRoot,
  deriveVisibleGraph,
  drillInto,
  drillTo,
  expandAll,
  initialExplorerState,
  maxContainerDepth,
  revealEntity,
  searchEntities,
  setCollapseLevel,
  toggleCollapse,
} from "@/explorer/explorer-model";

const NESTED = `flowchart LR
  subgraph outer[Outer module]
    subgraph inner[Inner module]
      a[Alpha]
      d[Delta]
    end
    b[Beta]
  end
  c(Gamma)
  a -->|calls| b
  d --> b
  b -. reads .-> c
  c ==> a`;

function snapshotFrom(text: string): GraphSnapshot {
  const result = importMermaidFlowchart({
    text,
    snapshotId: snapshotId("explorer-test"),
    importedAt: "1970-01-01T00:00:00.000Z",
  });
  if (!result.snapshot) throw new Error("fixture failed to import");
  return result.snapshot;
}

const id = (value: string) => value as EntityId;

describe("buildExplorerGraph", () => {
  it("recovers container nesting, depth, and leaf parents", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));

    expect(graph.containers.get(id("outer"))?.parent).toBeUndefined();
    expect(graph.containers.get(id("outer"))?.depth).toBe(0);
    expect(graph.containers.get(id("inner"))?.parent).toBe("outer");
    expect(graph.containers.get(id("inner"))?.depth).toBe(1);

    expect(graph.leaves.get(id("a"))?.parent).toBe("inner");
    expect(graph.leaves.get(id("a"))?.depth).toBe(2);
    expect(graph.leaves.get(id("c"))?.parent).toBeUndefined();
    expect(graph.leaves.get(id("c"))?.depth).toBe(0);
  });

  it("lists direct children of a container and of the root", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));

    expect(graph.childrenOf(id("inner"))).toEqual([id("a"), id("d")]);
    expect(graph.childrenOf(id("outer"))).toContain(id("inner"));
    expect(graph.childrenOf(id("outer"))).toContain(id("b"));
    expect(graph.childrenOf(undefined)).toEqual(
      expect.arrayContaining([id("outer"), id("c")]),
    );
  });
});

describe("ancestorsOf", () => {
  it("returns container ancestors nearest first", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    expect(ancestorsOf(graph, id("a"))).toEqual([id("inner"), id("outer")]);
    expect(ancestorsOf(graph, id("c"))).toEqual([]);
  });
});

describe("collapse operations", () => {
  it("collapse-all folds every leaf into its outermost container summary", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const state = collapseAll(initialExplorerState(), graph);
    const view = deriveVisibleGraph(graph, state);

    // Only the top-level summary (outer) and the ungrouped leaf (c) remain.
    expect(view.containers).toHaveLength(0);
    const outer = view.nodes.find((n) => n.id === "outer");
    expect(outer?.kind).toBe("summary");
    // outer aggregates a, d, b (inner's leaves fold into outer, the outermost collapsed ancestor).
    expect(outer?.aggregatedLeafCount).toBe(3);
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["c", "outer"]);
  });

  it("toggling one container collapses just its subtree", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const state = toggleCollapse(initialExplorerState(), id("inner"));
    const view = deriveVisibleGraph(graph, state);

    const inner = view.nodes.find((n) => n.id === "inner");
    expect(inner?.kind).toBe("summary");
    expect(inner?.aggregatedLeafCount).toBe(2); // a + d
    // outer stays an expanded frame; beta stays a visible leaf.
    expect(view.containers.map((c) => c.id)).toContain(id("outer"));
    expect(view.nodes.map((n) => n.id)).toContain(id("b"));
    expect(view.nodes.map((n) => n.id)).not.toContain(id("a"));
  });

  it("expand-all restores every leaf and container frame", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const view = deriveVisibleGraph(
      graph,
      expandAll(collapseAll(initialExplorerState(), graph)),
    );
    expect(view.containers.map((c) => c.id).sort()).toEqual(["inner", "outer"]);
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("edge rewiring under collapse", () => {
  it("rewires endpoints to summaries and aggregates parallel edges", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    // Collapse inner: a and d both fold into the `inner` summary. a->b and d->b both become inner->b.
    const view = deriveVisibleGraph(
      graph,
      toggleCollapse(initialExplorerState(), id("inner")),
    );
    const innerToB = view.edges.filter(
      (e) => e.source === "inner" && e.target === "b",
    );
    expect(innerToB).toHaveLength(1);
    expect(innerToB[0].aggregated).toBe(true);
  });

  it("drops edges internal to a collapsed container", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    // a->b crosses inner's boundary (b is outside inner) so it survives; there is no wholly-internal
    // edge here, so collapsing outer should drop a->b and d->b (both fold into outer) as self-edges.
    const view = deriveVisibleGraph(
      graph,
      toggleCollapse(initialExplorerState(), id("outer")),
    );
    const selfEdges = view.edges.filter((e) => e.source === e.target);
    expect(selfEdges).toHaveLength(0);
    // outer<->c edges (b->c and c->a) survive, rewired to outer.
    expect(
      view.edges.some((e) => e.source === "outer" && e.target === "c"),
    ).toBe(true);
    expect(
      view.edges.some((e) => e.source === "c" && e.target === "outer"),
    ).toBe(true);
  });
});

describe("level control", () => {
  it("collapses containers at or below the requested depth", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    expect(maxContainerDepth(graph)).toBe(1);

    // Level 1: outer (depth 0) expanded, inner (depth 1) collapsed.
    const level1 = deriveVisibleGraph(
      graph,
      setCollapseLevel(initialExplorerState(), graph, 1),
    );
    expect(level1.containers.map((c) => c.id)).toEqual([id("outer")]);
    expect(level1.nodes.map((n) => n.id)).toContain(id("inner"));

    // Level 0: everything collapsed to root summaries.
    const level0 = deriveVisibleGraph(
      graph,
      setCollapseLevel(initialExplorerState(), graph, 0),
    );
    expect(level0.containers).toHaveLength(0);
  });
});

describe("search and reveal", () => {
  it("matches leaves and containers by label or id", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    expect(searchEntities(graph, "module")).toEqual(
      expect.arrayContaining([id("outer"), id("inner")]),
    );
    expect(searchEntities(graph, "alpha")).toEqual([id("a")]);
    expect(searchEntities(graph, "")).toEqual([]);
  });

  it("reveal expands every ancestor of a hit and focuses it", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const collapsed = collapseAll(initialExplorerState(), graph);
    const revealed = revealEntity(collapsed, graph, id("a"));

    expect(revealed.focusId).toBe(id("a"));
    const view = deriveVisibleGraph(graph, revealed);
    expect(view.nodes.map((n) => n.id)).toContain(id("a"));
  });
});

describe("drill-down", () => {
  it("shows only the drilled container's subtree", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const state = drillInto(initialExplorerState(), graph, id("outer"));
    expect(currentDrillRoot(state)).toBe(id("outer"));

    const view = deriveVisibleGraph(graph, state);
    // Gamma (c) is outside outer, so it is not in the drilled view.
    expect(view.nodes.map((n) => n.id)).not.toContain(id("c"));
    // inner is a container directly under outer, drawn with no parent (outer is the canvas).
    const inner = view.containers.find((c) => c.id === "inner");
    expect(inner?.parent).toBeUndefined();
  });

  it("breadcrumb tracks the drill path and drillTo truncates it", () => {
    const graph = buildExplorerGraph(snapshotFrom(NESTED));
    const drilled = drillInto(
      drillInto(initialExplorerState(), graph, id("outer")),
      graph,
      id("inner"),
    );
    expect(breadcrumbTrail(drilled, graph).map((b) => b.label)).toEqual([
      "All",
      "Outer module",
      "Inner module",
    ]);

    const back = drillTo(drilled, id("outer"));
    expect(currentDrillRoot(back)).toBe(id("outer"));
    const out = drillTo(drilled, undefined);
    expect(currentDrillRoot(out)).toBeUndefined();
  });
});
