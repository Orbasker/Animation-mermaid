import { describe, expect, it } from "vitest";

import { parseFlowchart } from "@/domain/mermaid/parser";
import { RICH_FLOWCHART } from "@/domain/mermaid/fixtures";

describe("parseFlowchart headers", () => {
  it("reads the direction from the header", () => {
    expect(parseFlowchart("flowchart LR\n a --> b").direction).toBe("LR");
    expect(parseFlowchart("graph RL\n a --> b").direction).toBe("RL");
  });

  it("defaults the direction when omitted", () => {
    expect(parseFlowchart("flowchart\n a --> b").direction).toBe("TD");
  });

  it("is fatal when the header is not a flowchart", () => {
    const parsed = parseFlowchart("sequenceDiagram\n A->>B: hi");
    expect(parsed.fatal).toBe(true);
    expect(parsed.diagnostics[0]).toMatchObject({
      code: "not-a-flowchart",
      severity: "error",
      line: 1,
    });
  });

  it("is fatal for source with no flowchart", () => {
    const parsed = parseFlowchart("   \n\n");
    expect(parsed.fatal).toBe(true);
    expect(parsed.diagnostics[0].code).toBe("empty-source");
  });
});

describe("parseFlowchart nodes and shapes", () => {
  const parsed = parseFlowchart(RICH_FLOWCHART);

  it("maps node shapes from syntax", () => {
    const shapeOf = (id: string) => parsed.nodes.find((n) => n.id === id)?.shape;
    expect(shapeOf("start")).toBe("circle");
    expect(shapeOf("ui")).toBe("parallelogram");
    expect(shapeOf("decide")).toBe("diamond");
    expect(shapeOf("work")).toBe("subroutine");
    expect(shapeOf("store")).toBe("cylinder");
    expect(shapeOf("done")).toBe("stadium");
  });

  it("uses the inner text as the label", () => {
    expect(parsed.nodes.find((n) => n.id === "decide")?.label).toBe("Valid?");
    expect(parsed.nodes.find((n) => n.id === "ui")?.label).toBe("User Input");
  });
});

describe("parseFlowchart edges", () => {
  const parsed = parseFlowchart(RICH_FLOWCHART);
  const edge = (source: string, target: string) =>
    parsed.edges.find((e) => e.source === source && e.target === target);

  it("parses pipe, inline, dotted, and thick edges", () => {
    expect(edge("ui", "decide")).toMatchObject({ label: "submit", line: "solid" });
    expect(edge("decide", "work")).toMatchObject({ label: "yes", line: "solid" });
    expect(edge("decide", "done")).toMatchObject({ label: "no", line: "dotted" });
    expect(edge("work", "done")).toMatchObject({ line: "thick" });
  });

  it("expands chained edges into pairs", () => {
    expect(edge("decide", "work")).toBeDefined();
    expect(edge("work", "store")).toBeDefined();
  });
});

describe("parseFlowchart subgraphs", () => {
  const parsed = parseFlowchart(RICH_FLOWCHART);

  it("nests groups and assigns membership by first mention", () => {
    const app = parsed.groups.find((g) => g.id === "app");
    const core = parsed.groups.find((g) => g.id === "core");
    expect(app?.memberIds).toContain("ui");
    expect(app?.memberIds).toContain("core");
    expect(core?.memberIds).toEqual(["decide", "work"]);
    expect(parsed.nodes.find((n) => n.id === "decide")?.groupId).toBe("core");
    expect(parsed.nodes.find((n) => n.id === "ui")?.groupId).toBe("app");
  });

  it("reports an unclosed subgraph", () => {
    const parsedOpen = parseFlowchart("flowchart TD\n subgraph g[G]\n a[A]");
    expect(parsedOpen.diagnostics.map((d) => d.code)).toContain(
      "unclosed-subgraph",
    );
  });

  it("reports a stray end", () => {
    const parsedEnd = parseFlowchart("flowchart TD\n a[A]\n end");
    expect(parsedEnd.diagnostics.map((d) => d.code)).toContain("unexpected-end");
  });
});
