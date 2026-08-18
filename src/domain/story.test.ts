import { describe, expect, it } from "vitest";

import { entityId, snapshotId } from "@/domain/graph";
import {
  createStory,
  sceneId,
  storyDurationMs,
  storyId,
  validateStory,
} from "@/domain/story";
import { currentArchitectureSnapshot, sampleProjectDocument } from "@/domain/fixtures";

describe("validateStory", () => {
  const snapshot = currentArchitectureSnapshot();

  it("accepts the representative story", () => {
    const story = sampleProjectDocument().stories[0];
    expect(validateStory(story, snapshot)).toEqual([]);
  });

  it("sums scene durations", () => {
    const story = sampleProjectDocument().stories[0];
    expect(storyDurationMs(story)).toBe(1000 + 1500 + 1200);
  });

  it("flags a story validated against the wrong snapshot", () => {
    const story = createStory({
      id: storyId("s"),
      title: "T",
      snapshotId: snapshotId("other"),
      scenes: [],
    });
    const errors = validateStory(story, snapshot);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("story-snapshot-mismatch");
  });

  it("reports duplicate scenes, negative durations, and unknown entities", () => {
    const story = createStory({
      id: storyId("s"),
      title: "T",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("dup"),
          title: "one",
          durationMs: -5,
          actions: [{ type: "reveal", target: entityId("ghost") }],
        },
        { id: sceneId("dup"), title: "two", durationMs: 100, actions: [] },
      ],
    });
    const errors = validateStory(story, snapshot);
    const codes = errors.map((e) => e.code).sort();
    expect(codes).toEqual([
      "action-missing-entity",
      "duplicate-scene-id",
      "negative-duration",
    ]);
    expect(errors.find((e) => e.code === "action-missing-entity")?.message).toContain(
      "ghost",
    );
  });
});
