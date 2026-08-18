import { describe, expect, it } from "vitest";

import { buildAgentContextPackage } from "@/domain/agent-context";
import { currentArchitectureSnapshot } from "@/domain/fixtures";
import {
  createProjectDocument,
  projectId,
  validateProjectDocument,
} from "@/domain/project-document";

import {
  agentContextPackageSchema,
  type Critique,
  type NarrativeAnalysis,
  type SceneDraft,
  type ValidatedAgentContext,
} from "./contract";
import { assembleStory, buildStoryProposal, InvalidStoryDraftError } from "./proposal";

const snapshot = currentArchitectureSnapshot();

const context: ValidatedAgentContext = agentContextPackageSchema.parse(
  buildAgentContextPackage({
    intent: "Explain the current request path to a new reviewer.",
    snapshot,
  }),
);

const analysis: NarrativeAnalysis = {
  thesis: "Requests fan out through the API gateway.",
  audience: "New reviewers.",
  beats: [{ summary: "Start at the client.", entityIds: ["client"] }],
};

const critique: Critique = {
  verdict: "ready",
  summary: "The scenes follow the thesis.",
  notes: [],
};

const drafts: readonly SceneDraft[] = [
  {
    title: "The client arrives",
    durationMs: 2_000,
    actions: [
      { type: "reveal", target: "client" },
      { type: "annotate", target: "client", text: "A request starts here." },
    ],
  },
  {
    title: "Through the gateway",
    durationMs: 3_000,
    actions: [
      { type: "reveal", target: "api" },
      { type: "highlight", target: "client->api", style: "emphasis" },
      { type: "camera", focus: ["client", "api"] },
    ],
  },
];

function build(overrides: { readonly drafts?: readonly SceneDraft[] } = {}) {
  return buildStoryProposal({
    title: "Request path today",
    context,
    drafts: overrides.drafts ?? drafts,
    analysis,
    critique,
  });
}

describe("buildStoryProposal", () => {
  it("returns an identical payload for identical inputs", () => {
    expect(build()).toEqual(build());
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("derives scene ids from position rather than a generator", () => {
    const { story } = build();

    expect(story.scenes.map((scene) => scene.id)).toEqual(["scene-1", "scene-2"]);
  });

  it("changes the proposal id when the scenes change", () => {
    const other = build({
      drafts: [{ ...drafts[0], durationMs: 2_500 }, drafts[1]],
    });

    expect(other.proposalId).not.toBe(build().proposalId);
  });

  it("keeps the story id stable across a key-order difference in the drafts", () => {
    const reordered: readonly SceneDraft[] = drafts.map((draft) => ({
      actions: draft.actions,
      durationMs: draft.durationMs,
      title: draft.title,
    }));

    expect(build({ drafts: reordered }).story.id).toBe(build().story.id);
  });

  it("totals the scene durations", () => {
    expect(build().totalDurationMs).toBe(5_000);
  });

  it("emits a story at the current schema version, targeting the context snapshot", () => {
    const { story } = build();

    expect(story.schemaVersion).toBe(1);
    expect(story.snapshotId).toBe("snap-current");
  });

  it("produces a story that validates inside a real project document", () => {
    const { story } = build();
    const project = createProjectDocument({
      id: projectId("proj-1"),
      name: "Review",
      snapshots: [snapshot],
      // The proposal carries a domain `Story`, so it goes straight in and is checked with
      // the project's own validator.
      stories: [story],
    });

    expect(validateProjectDocument(project)).toEqual([]);
  });

  it("rejects a draft naming an entity the graph does not contain", () => {
    expect(() =>
      build({
        drafts: [
          {
            title: "Invented",
            durationMs: 1_000,
            actions: [{ type: "reveal", target: "not-a-real-entity" }],
          },
        ],
      }),
    ).toThrowError(InvalidStoryDraftError);
  });

  it("names the reason a draft was rejected", () => {
    try {
      build({
        drafts: [
          {
            title: "Invented",
            durationMs: 1_000,
            actions: [{ type: "camera", focus: ["ghost"] }],
          },
        ],
      });
      expect.unreachable("expected the draft to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStoryDraftError);
      expect((error as InvalidStoryDraftError).code).toBe("unknown-entity-reference");
      expect((error as InvalidStoryDraftError).details[0]).toContain("ghost");
    }
  });

  it("rejects an empty draft list", () => {
    expect(() => build({ drafts: [] })).toThrowError(/no scenes/i);
  });
});

describe("assembleStory", () => {
  it("preserves optional action fields only when present", () => {
    const story = assembleStory("t", context, drafts);
    const [reveal] = story.scenes[0].actions;
    const highlight = story.scenes[1].actions[1];

    expect(reveal).toEqual({ type: "reveal", target: "client" });
    expect(highlight).toEqual({
      type: "highlight",
      target: "client->api",
      style: "emphasis",
    });
  });

  it("omits an absent highlight style rather than writing undefined", () => {
    const story = assembleStory("t", context, [
      {
        title: "Plain highlight",
        durationMs: 100,
        actions: [{ type: "highlight", target: "api" }],
      },
    ]);

    expect(Object.keys(story.scenes[0].actions[0])).toEqual(["type", "target"]);
  });
});
