import { describe, expect, it } from "vitest";

import {
  buildStructureDiagram,
  StructureDiagramError,
} from "@/preview/structure-model";

const NESTED = `flowchart LR
  subgraph outer[Outer module]
    subgraph inner[Inner module]
      a[Alpha]
    end
    b[Beta]
  end
  c(Gamma)
  a -->|calls| b
  b -. reads .-> c
  c ==> a`;

describe("buildStructureDiagram", () => {
  it("recovers direction, node parents, and nested group parents", () => {
    const diagram = buildStructureDiagram({
      id: "nested",
      name: "Nested",
      source: NESTED,
    });

    expect(diagram.direction).toBe("LR");

    const inner = diagram.groups.find((g) => g.id === "inner");
    const outer = diagram.groups.find((g) => g.id === "outer");
    expect(outer?.parent).toBeUndefined();
    expect(inner?.parent).toBe("outer");

    const alpha = diagram.nodes.find((n) => n.id === "a");
    const gamma = diagram.nodes.find((n) => n.id === "c");
    expect(alpha?.parent).toBe("inner");
    expect(gamma?.parent).toBeUndefined();
    expect(gamma?.shape).toBe("round");
  });

  it("preserves edge line styles", () => {
    const diagram = buildStructureDiagram({
      id: "nested",
      name: "Nested",
      source: NESTED,
    });

    const byPair = (s: string, t: string) =>
      diagram.edges.find((e) => e.source === s && e.target === t);

    expect(byPair("a", "b")?.line).toBe("solid");
    expect(byPair("a", "b")?.label).toBe("calls");
    expect(byPair("b", "c")?.line).toBe("dotted");
    expect(byPair("c", "a")?.line).toBe("thick");
  });

  it("throws when the source is not a flowchart", () => {
    expect(() =>
      buildStructureDiagram({
        id: "bad",
        name: "Bad",
        source: "sequenceDiagram\n  A->>B: hi",
      }),
    ).toThrow(StructureDiagramError);
  });
});
