import { describe, expect, it } from "vitest";

import { buildAgentContextPackage } from "@/domain/agent-context";
import { currentArchitectureSnapshot } from "@/domain/fixtures";

import {
  agentContextPackageSchema,
  storyDecisionSchema,
  storyRequestSchema,
} from "./contract";

function validContext() {
  return buildAgentContextPackage({
    intent: "Explain the current request path to a new reviewer.",
    snapshot: currentArchitectureSnapshot(),
  });
}

describe("agentContextPackageSchema", () => {
  it("accepts a package built by the domain projector", () => {
    const parsed = agentContextPackageSchema.safeParse(validContext());

    expect(parsed.success).toBe(true);
  });

  it("rejects a package carrying layout data the agent must never see", () => {
    const parsed = agentContextPackageSchema.safeParse({
      ...validContext(),
      layout: [{ entityId: "api", x: 10, y: 20 }],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects renderer detail smuggled onto a graph entity", () => {
    const context = validContext();
    const parsed = agentContextPackageSchema.safeParse({
      ...context,
      graph: {
        ...context.graph,
        entities: [{ ...context.graph.entities[0], position: { x: 1, y: 2 } }],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an unsupported schema version rather than guessing", () => {
    const parsed = agentContextPackageSchema.safeParse({
      ...validContext(),
      schemaVersion: 99,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an empty graph, which has no story to tell", () => {
    const context = validContext();
    const parsed = agentContextPackageSchema.safeParse({
      ...context,
      graph: { ...context.graph, entities: [] },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate entity ids", () => {
    const context = validContext();
    const first = context.graph.entities[0];
    const parsed = agentContextPackageSchema.safeParse({
      ...context,
      graph: { ...context.graph, entities: [first, first] },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("storyRequestSchema", () => {
  it("defaults the scene count so a caller need not choose one", () => {
    const parsed = storyRequestSchema.parse({
      title: "Request path today",
      context: validContext(),
    });

    expect(parsed.sceneCount).toBe(6);
  });

  it("rejects a scene count that would produce an unbounded story", () => {
    const parsed = storyRequestSchema.safeParse({
      title: "Request path today",
      context: validContext(),
      sceneCount: 500,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const parsed = storyRequestSchema.safeParse({
      title: "",
      context: validContext(),
    });

    expect(parsed.success).toBe(false);
  });
});

describe("storyDecisionSchema", () => {
  it("accepts approve and reject", () => {
    expect(storyDecisionSchema.safeParse({ decision: "approve" }).success).toBe(
      true,
    );
    expect(
      storyDecisionSchema.safeParse({
        decision: "reject",
        note: "Beat 3 is wrong.",
      }).success,
    ).toBe(true);
  });

  it("rejects any other decision, so an unknown verb cannot resume a run", () => {
    expect(storyDecisionSchema.safeParse({ decision: "maybe" }).success).toBe(
      false,
    );
    expect(
      storyDecisionSchema.safeParse({ decision: "approve!" }).success,
    ).toBe(false);
  });
});
