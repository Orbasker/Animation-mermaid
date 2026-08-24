import { describe, expect, it } from "vitest";

import { parseGraphviz } from "@/domain/graphviz/parser";

describe("parseGraphviz headers", () => {
  it("parses a directed graph header with a name", () => {
    const parsed = parseGraphviz("digraph G { a -> b }");
    expect(parsed.fatal).toBe(false);
    expect(parsed.directed).toBe(true);
    expect(parsed.edges).toEqual([{ source: "a", target: "b", line: "solid" }]);
  });

  it("parses an undirected graph with `--` edges", () => {
    const parsed = parseGraphviz("graph { a -- b -- c }");
    expect(parsed.fatal).toBe(false);
    expect(parsed.directed).toBe(false);
    expect(parsed.edges.map((e) => `${e.source}-${e.target}`)).toEqual([
      "a-b",
      "b-c",
    ]);
  });

  it("accepts a `strict digraph` header", () => {
    const parsed = parseGraphviz("strict digraph { a -> b }");
    expect(parsed.fatal).toBe(false);
    expect(parsed.directed).toBe(true);
  });

  it("is fatal on a non-graphviz header", () => {
    const parsed = parseGraphviz("flowchart TD\n a --> b");
    expect(parsed.fatal).toBe(true);
    expect(parsed.diagnostics[0].code).toBe("not-a-graphviz");
  });

  it("is fatal on empty source", () => {
    const parsed = parseGraphviz("   \n  ");
    expect(parsed.fatal).toBe(true);
    expect(parsed.diagnostics[0].code).toBe("empty-source");
  });
});

describe("parseGraphviz structure", () => {
  it("reads rankdir into the layout direction", () => {
    expect(parseGraphviz("digraph { rankdir=LR; a -> b }").direction).toBe(
      "LR",
    );
    expect(parseGraphviz("digraph { a -> b }").direction).toBe("TB");
  });

  it("carries quoted labels, ids with spaces, and shapes", () => {
    const parsed = parseGraphviz(
      'digraph { "n 1" [label="Node One", shape=diamond] }',
    );
    expect(parsed.nodes).toEqual([
      { id: "n 1", label: "Node One", shape: "diamond" },
    ]);
  });

  it("strips ports and compass points from edge endpoints", () => {
    const parsed = parseGraphviz("digraph { a:f0:n -> b:w }");
    expect(parsed.edges).toEqual([{ source: "a", target: "b", line: "solid" }]);
    expect(parsed.diagnostics.some((d) => d.code === "port-ignored")).toBe(
      true,
    );
  });

  it("maps dashed/dotted/bold edge styles to line styles", () => {
    const parsed = parseGraphviz(
      "digraph { a -> b [style=dashed]; a -> c [style=bold]; a -> d }",
    );
    const line = (t: string) => parsed.edges.find((e) => e.target === t)?.line;
    expect(line("b")).toBe("dotted");
    expect(line("c")).toBe("thick");
    expect(line("d")).toBe("solid");
  });

  it("ignores every comment form", () => {
    const parsed = parseGraphviz(
      [
        "# a preprocessor line",
        "// a line comment",
        "digraph {",
        "  /* a block comment */ a -> b",
        "}",
      ].join("\n"),
    );
    expect(parsed.fatal).toBe(false);
    expect(parsed.edges).toEqual([{ source: "a", target: "b", line: "solid" }]);
  });
});

describe("parseGraphviz clusters", () => {
  it("makes `cluster_*` subgraphs nested containers and leaves plain subgraphs transparent", () => {
    const parsed = parseGraphviz(
      [
        "digraph {",
        "  subgraph cluster_a {",
        '    label="A"',
        "    x",
        "    subgraph cluster_b { y }",
        "  }",
        "  subgraph plain { z }",
        "}",
      ].join("\n"),
    );

    expect(parsed.groups.map((g) => g.id).sort()).toEqual([
      "cluster_a",
      "cluster_b",
    ]);
    const a = parsed.groups.find((g) => g.id === "cluster_a")!;
    expect(a.label).toBe("A");
    expect(a.memberIds).toEqual(["x", "cluster_b"]);
    expect(parsed.groups.find((g) => g.id === "cluster_b")!.memberIds).toEqual([
      "y",
    ]);

    expect(parsed.nodes.find((n) => n.id === "x")!.groupId).toBe("cluster_a");
    expect(parsed.nodes.find((n) => n.id === "y")!.groupId).toBe("cluster_b");
    // `z` sits in a non-cluster subgraph, so it belongs to no drawable container.
    expect(parsed.nodes.find((n) => n.id === "z")!.groupId).toBeUndefined();
  });
});
