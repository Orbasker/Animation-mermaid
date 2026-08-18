import { describe, expect, it } from "vitest";

import {
  applyStoryProposal,
  planStoryApplication,
  StoryNotApplicableError,
} from "@/domain/apply-proposal";
import { currentArchitectureSnapshot } from "@/domain/fixtures";
import { entityId, snapshotId } from "@/domain/graph";
import {
  createProjectDocument,
  projectId,
  validateProjectDocument,
  type ProjectDocument,
} from "@/domain/project-document";
import { createStory, sceneId, storyId, type Story } from "@/domain/story";

const current = currentArchitectureSnapshot();

function baseProject(): ProjectDocument {
  return createProjectDocument({
    id: projectId("proj"),
    name: "Project",
    snapshots: [current],
  });
}

function proposedStory(id = "story-proposed"): Story {
  return createStory({
    id: storyId(id),
    title: "Proposed walkthrough",
    snapshotId: current.id,
    scenes: [
      {
        id: sceneId("scene-1"),
        title: "Reveal the client",
        durationMs: 1000,
        actions: [
          { type: "reveal", target: entityId("client") },
          { type: "camera", focus: [entityId("client"), entityId("api")] },
        ],
      },
      {
        id: sceneId("scene-2"),
        title: "Reach the service",
        durationMs: 1500,
        actions: [{ type: "highlight", target: entityId("service"), style: "active" }],
      },
    ],
  });
}

describe("planStoryApplication", () => {
  it("summarizes each scene and reports the story as applicable", () => {
    const plan = planStoryApplication(baseProject(), proposedStory());

    expect(plan.applicable).toBe(true);
    expect(plan.mode).toBe("add");
    expect(plan.snapshotFound).toBe(true);
    expect(plan.totalDurationMs).toBe(2500);
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0].targets).toEqual([
      entityId("client"),
      entityId("api"),
    ]);
    expect(plan.scenes[0].actionCount).toBe(2);
  });

  it("reports a missing target snapshot as inapplicable without throwing", () => {
    const orphan = createStory({
      id: storyId("orphan"),
      title: "Orphan",
      snapshotId: snapshotId("does-not-exist"),
      scenes: [
        {
          id: sceneId("s"),
          title: "s",
          durationMs: 500,
          actions: [{ type: "reveal", target: entityId("client") }],
        },
      ],
    });

    const plan = planStoryApplication(baseProject(), orphan);

    expect(plan.applicable).toBe(false);
    expect(plan.snapshotFound).toBe(false);
    expect(plan.errors).not.toHaveLength(0);
  });

  it("flags a story referencing an unknown entity as inapplicable", () => {
    const invalid = createStory({
      id: storyId("invalid"),
      title: "Invalid",
      snapshotId: current.id,
      scenes: [
        {
          id: sceneId("s"),
          title: "s",
          durationMs: 500,
          actions: [{ type: "reveal", target: entityId("ghost") }],
        },
      ],
    });

    const plan = planStoryApplication(baseProject(), invalid);

    expect(plan.applicable).toBe(false);
    expect(plan.errors.some((error) => error.code === "action-missing-entity")).toBe(true);
  });

  it("marks an already-present story as a no-op", () => {
    const story = proposedStory();
    const project = { ...baseProject(), stories: [story] };

    expect(planStoryApplication(project, story).mode).toBe("noop");
  });

  it("lists sibling stories that animate the same snapshot", () => {
    const existing = proposedStory("story-existing");
    const project = { ...baseProject(), stories: [existing] };

    const plan = planStoryApplication(project, proposedStory("story-new"));

    expect(plan.siblingStoryIds).toEqual([existing.id]);
  });
});

describe("applyStoryProposal", () => {
  it("appends the story and keeps the project valid", () => {
    const project = baseProject();
    const story = proposedStory();

    const next = applyStoryProposal(project, story);

    expect(next.stories).toHaveLength(1);
    expect(next.stories[0]).toBe(story);
    expect(validateProjectDocument(next)).toHaveLength(0);
    // Original document is untouched — the pair is a reversible transaction.
    expect(project.stories).toHaveLength(0);
  });

  it("is idempotent for an already-applied story", () => {
    const project = baseProject();
    const story = proposedStory();
    const once = applyStoryProposal(project, story);
    const twice = applyStoryProposal(once, story);

    expect(twice).toBe(once);
    expect(twice.stories).toHaveLength(1);
  });

  it("throws StoryNotApplicableError for an inapplicable story", () => {
    const invalid = createStory({
      id: storyId("invalid"),
      title: "Invalid",
      snapshotId: current.id,
      scenes: [
        {
          id: sceneId("s"),
          title: "s",
          durationMs: 500,
          actions: [{ type: "reveal", target: entityId("ghost") }],
        },
      ],
    });

    expect(() => applyStoryProposal(baseProject(), invalid)).toThrow(
      StoryNotApplicableError,
    );
  });
});
