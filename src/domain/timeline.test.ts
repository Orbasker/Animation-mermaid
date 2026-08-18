import { describe, expect, it } from "vitest";

import { entityId } from "@/domain/graph";
import { createStory, sceneId, storyId, validateStory } from "@/domain/story";
import {
  allocateSceneId,
  applyTimelineOperation,
  collectSceneReferenceWarnings,
  repairSceneReferences,
  type TimelineOperation,
} from "@/domain/timeline";
import { currentArchitectureSnapshot, sampleProjectDocument } from "@/domain/fixtures";

const snapshot = currentArchitectureSnapshot();

function emptyStory() {
  return createStory({
    id: storyId("story-authoring"),
    title: "Authoring",
    snapshotId: snapshot.id,
  });
}

function apply(story = emptyStory(), ...operations: TimelineOperation[]) {
  return operations.reduce(applyTimelineOperation, story);
}

describe("allocateSceneId", () => {
  it("never collides with existing scene ids", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("scene-1"), title: "One", durationMs: 1000 },
      { type: "add-scene", id: sceneId("scene-2"), title: "Two", durationMs: 1000 },
    );
    expect(allocateSceneId(story)).toBe(sceneId("scene-3"));
  });
});

describe("applyTimelineOperation", () => {
  it("authors a four-scene review from the acceptance fixture", () => {
    let story = emptyStory();
    for (const [index, target] of [
      entityId("client"),
      entityId("api"),
      entityId("service"),
      entityId("db"),
    ].entries()) {
      const id = allocateSceneId(story);
      story = apply(
        story,
        { type: "add-scene", id, title: `Scene ${index + 1}`, durationMs: 1000 },
        { type: "set-action", sceneId: id, action: { type: "reveal", target } },
      );
    }

    expect(story.scenes).toHaveLength(4);
    expect(validateStory(story, snapshot)).toEqual([]);
  });

  it("inserts a scene after a named scene", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "A", durationMs: 1000 },
      { type: "add-scene", id: sceneId("b"), title: "B", durationMs: 1000 },
      { type: "add-scene", id: sceneId("c"), title: "C", durationMs: 1000, afterSceneId: sceneId("a") },
    );
    expect(story.scenes.map((scene) => scene.id)).toEqual([
      sceneId("a"),
      sceneId("c"),
      sceneId("b"),
    ]);
  });

  it("duplicates a scene without duplicating graph entities", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "Reveal client", durationMs: 1000 },
      { type: "set-action", sceneId: sceneId("a"), action: { type: "reveal", target: entityId("client") } },
      { type: "duplicate-scene", sceneId: sceneId("a"), id: sceneId("a-copy") },
    );

    expect(story.scenes.map((scene) => scene.id)).toEqual([
      sceneId("a"),
      sceneId("a-copy"),
    ]);
    const copy = story.scenes[1];
    expect(copy.title).toBe("Reveal client copy");
    expect(copy.actions).toEqual(story.scenes[0].actions);
    // References are shared by id — the entity itself is never copied into the story.
    expect(validateStory(story, snapshot)).toEqual([]);
  });

  it("reorders scenes without duplicating references", () => {
    const base = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "A", durationMs: 1000 },
      { type: "set-action", sceneId: sceneId("a"), action: { type: "reveal", target: entityId("client") } },
      { type: "add-scene", id: sceneId("b"), title: "B", durationMs: 1000 },
      { type: "set-action", sceneId: sceneId("b"), action: { type: "reveal", target: entityId("api") } },
    );

    const reordered = apply(base, { type: "move-scene", sceneId: sceneId("b"), toIndex: 0 });

    expect(reordered.scenes.map((scene) => scene.id)).toEqual([sceneId("b"), sceneId("a")]);
    expect(reordered.scenes).toHaveLength(base.scenes.length);
    expect(reordered.scenes.flatMap((scene) => scene.actions)).toHaveLength(2);
  });

  it("renames and re-times a scene", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "A", durationMs: 1000 },
      { type: "rename-scene", sceneId: sceneId("a"), title: "Renamed" },
      { type: "set-duration", sceneId: sceneId("a"), durationMs: 2500 },
    );
    expect(story.scenes[0]).toMatchObject({ title: "Renamed", durationMs: 2500 });
  });

  it("removes a scene", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "A", durationMs: 1000 },
      { type: "add-scene", id: sceneId("b"), title: "B", durationMs: 1000 },
      { type: "remove-scene", sceneId: sceneId("a") },
    );
    expect(story.scenes.map((scene) => scene.id)).toEqual([sceneId("b")]);
  });

  it("upserts an action rather than accumulating conflicting ones", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "A", durationMs: 1000 },
      { type: "set-action", sceneId: sceneId("a"), action: { type: "reveal", target: entityId("api") } },
      { type: "set-action", sceneId: sceneId("a"), action: { type: "hide", target: entityId("api") } },
    );

    expect(story.scenes[0].actions).toEqual([{ type: "hide", target: entityId("api") }]);
    expect(validateStory(story, snapshot)).toEqual([]);
  });

  it("removes an action by channel and target", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "A", durationMs: 1000 },
      { type: "set-action", sceneId: sceneId("a"), action: { type: "reveal", target: entityId("api") } },
      { type: "set-action", sceneId: sceneId("a"), action: { type: "focus", target: entityId("api") } },
      { type: "remove-action", sceneId: sceneId("a"), channel: "visibility", target: entityId("api") },
    );
    expect(story.scenes[0].actions).toEqual([{ type: "focus", target: entityId("api") }]);
  });

  it("removes the single camera slot without a target", () => {
    const story = apply(
      emptyStory(),
      { type: "add-scene", id: sceneId("a"), title: "A", durationMs: 1000 },
      { type: "set-action", sceneId: sceneId("a"), action: { type: "camera", focus: [entityId("api")] } },
      { type: "remove-action", sceneId: sceneId("a"), channel: "camera" },
    );
    expect(story.scenes[0].actions).toEqual([]);
  });

  it("leaves the story untouched for operations on unknown scenes", () => {
    const story = emptyStory();
    expect(applyTimelineOperation(story, { type: "remove-scene", sceneId: sceneId("ghost") })).toBe(
      story,
    );
  });
});

describe("scene reference warnings and repair", () => {
  const story = sampleProjectDocument().stories[0];

  it("has no warnings against its own snapshot", () => {
    expect(collectSceneReferenceWarnings(story, snapshot)).toEqual([]);
  });

  it("warns per scene when referenced entities disappear", () => {
    const withoutService = {
      ...snapshot,
      entities: snapshot.entities.filter((entity) => entity.id !== entityId("service")),
    };

    const warnings = collectSceneReferenceWarnings(story, withoutService);
    expect(warnings.map((warning) => warning.sceneId)).toEqual([sceneId("scene-backend")]);
    expect(warnings[0].missingEntityIds).toContain(entityId("service"));
  });

  it("repairs dangling references so the story validates again", () => {
    const withoutService = {
      ...snapshot,
      entities: snapshot.entities.filter(
        (entity) => entity.id !== entityId("service") && entity.id !== entityId("api->service"),
      ),
    };

    const repaired = repairSceneReferences(story, withoutService);
    expect(collectSceneReferenceWarnings(repaired, withoutService)).toEqual([]);
    expect(validateStory(repaired, withoutService)).toEqual([]);
    // The scenes and their order survive; only broken references were pruned.
    expect(repaired.scenes.map((scene) => scene.id)).toEqual(
      story.scenes.map((scene) => scene.id),
    );
  });

  it("keeps a camera frame, dropping only the entities that vanished", () => {
    const story = createStory({
      id: storyId("cam"),
      title: "Camera",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("frame"),
          title: "Frame",
          durationMs: 1000,
          actions: [{ type: "camera", focus: [entityId("client"), entityId("ghost")] }],
        },
      ],
    });

    const repaired = repairSceneReferences(story, snapshot);
    expect(repaired.scenes[0].actions).toEqual([
      { type: "camera", focus: [entityId("client")] },
    ]);
  });
});
