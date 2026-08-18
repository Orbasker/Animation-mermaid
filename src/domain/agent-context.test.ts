import { describe, expect, it } from "vitest";

import {
  buildAgentContextPackage,
  redactAgentContext,
} from "@/domain/agent-context";
import { compareSnapshots, comparisonId } from "@/domain/comparison";
import { entityId } from "@/domain/graph";
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

describe("redactAgentContext", () => {
  const current = currentArchitectureSnapshot();

  function fullContext() {
    return buildAgentContextPackage({ intent: "Review", snapshot: current });
  }

  it("returns an equivalent package when every entity is kept", () => {
    const pkg = fullContext();
    const kept = redactAgentContext(
      pkg,
      pkg.graph.entities.map((entity) => entity.id),
    );
    expect(kept).toEqual(pkg);
  });

  it("removes a deselected entity from the request fixture entirely", () => {
    const pkg = fullContext();
    const kept = pkg.graph.entities
      .map((entity) => entity.id)
      .filter((id) => id !== entityId("db"));

    const redacted = redactAgentContext(pkg, kept);
    const serialized = JSON.stringify(redacted);

    expect(redacted.graph.entities.some((entity) => entity.id === entityId("db"))).toBe(false);
    expect(serialized).not.toContain('"db"');
    // The edge into the dropped node is pruned rather than left dangling.
    expect(serialized).not.toContain("service->db");
  });

  it("drops a group left without any included members and clears the node back-reference", () => {
    const pkg = fullContext();
    // Keep the API node but drop the backend group and the other member.
    const kept = [entityId("api")];

    const redacted = redactAgentContext(pkg, kept);

    expect(redacted.graph.entities).toHaveLength(1);
    const [node] = redacted.graph.entities;
    expect(node.kind).toBe("node");
    expect(node).not.toHaveProperty("groupId");
  });

  it("keeps a surviving group but trims it to its included members", () => {
    const pkg = fullContext();
    const kept = [entityId("backend"), entityId("api")];

    const redacted = redactAgentContext(pkg, kept);
    const group = redacted.graph.entities.find((entity) => entity.kind === "group");

    expect(group).toBeDefined();
    expect(group?.kind === "group" && group.memberIds).toEqual([entityId("api")]);
  });

  it("prunes comparison changes for entities not in the kept set", () => {
    const proposed = proposedArchitectureSnapshot();
    const pkg = buildAgentContextPackage({
      intent: "Compare",
      snapshot: current,
      comparison: compareSnapshots(comparisonId("c"), current, proposed),
    });
    // The comparison references `cache`, which the proposed snapshot adds and the current
    // graph never contained — keeping every current entity must still drop that change.
    expect(
      pkg.comparison?.changes.some((change) => change.entityId === entityId("cache")),
    ).toBe(true);

    const redacted = redactAgentContext(
      pkg,
      pkg.graph.entities.map((entity) => entity.id),
    );

    expect(
      redacted.comparison?.changes.some((change) => change.entityId === entityId("cache")),
    ).toBe(false);
  });
});
