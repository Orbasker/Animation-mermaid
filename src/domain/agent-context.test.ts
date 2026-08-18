import { describe, expect, it } from "vitest";

import { buildAgentContextPackage } from "@/domain/agent-context";
import { compareSnapshots, comparisonId } from "@/domain/comparison";
import {
  currentArchitectureSnapshot,
  proposedArchitectureSnapshot,
} from "@/domain/fixtures";

describe("buildAgentContextPackage", () => {
  const current = currentArchitectureSnapshot();

  it("exposes semantic entities and the diagram type", () => {
    const pkg = buildAgentContextPackage({
      intent: "Review this architecture",
      snapshot: current,
    });
    expect(pkg.graph.diagramType).toBe("flowchart");
    expect(pkg.graph.entities.length).toBe(current.entities.length);
    expect(pkg.intent).toBe("Review this architecture");
  });

  it("strips layout and renderer-specific attributes from the boundary", () => {
    const pkg = buildAgentContextPackage({
      intent: "Review",
      snapshot: current,
    });
    const serialized = JSON.stringify(pkg);
    expect(serialized).not.toContain("layout");
    expect(serialized).not.toContain("attributes");
    for (const entity of pkg.graph.entities) {
      expect(entity).not.toHaveProperty("attributes");
      expect(entity).not.toHaveProperty("x");
      expect(entity).not.toHaveProperty("y");
    }
  });

  it("includes an optional semantic comparison", () => {
    const proposed = proposedArchitectureSnapshot();
    const pkg = buildAgentContextPackage({
      intent: "Compare",
      snapshot: current,
      comparison: compareSnapshots(comparisonId("c"), current, proposed),
    });
    expect(pkg.comparison?.baseSnapshotId).toBe(current.id);
    expect(pkg.comparison?.changes.length).toBeGreaterThan(0);
  });
});
