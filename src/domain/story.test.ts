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

  it("rejects non-finite transforms before they reach persistence", () => {
    const story = createStory({
      id: storyId("non-finite"),
      title: "Non-finite",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("transform"),
          title: "Transform",
          durationMs: 100,
          actions: [
            {
              type: "transform",
              target: entityId("client"),
              to: {
                translateX: Number.POSITIVE_INFINITY,
                translateY: 0,
                scale: 1,
                rotateDeg: 0,
              },
            },
          ],
        },
      ],
    });

    expect(validateStory(story, snapshot)).toEqual([
      expect.objectContaining({ code: "non-finite-transform" }),
    ]);
  });

  it("rejects zero-duration scenes", () => {
    const story = createStory({
      id: storyId("zero"),
      title: "Zero",
      snapshotId: snapshot.id,
      scenes: [
        { id: sceneId("zero"), title: "Zero", durationMs: 0, actions: [] },
      ],
    });

    expect(validateStory(story, snapshot)).toEqual([
      expect.objectContaining({ code: "zero-duration" }),
    ]);
  });

  it("rejects non-finite scene durations", () => {
    const story = createStory({
      id: storyId("non-finite-duration"),
      title: "Non-finite duration",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("non-finite"),
          title: "Non-finite",
          durationMs: Number.NaN,
          actions: [],
        },
      ],
    });

    expect(validateStory(story, snapshot)).toEqual([
      expect.objectContaining({ code: "non-finite-duration" }),
    ]);
  });

  it("rejects a finite scene set whose aggregate duration overflows", () => {
    const story = createStory({
      id: storyId("overflow-duration"),
      title: "Overflow duration",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("one"),
          title: "One",
          durationMs: Number.MAX_VALUE,
          actions: [],
        },
        {
          id: sceneId("two"),
          title: "Two",
          durationMs: Number.MAX_VALUE,
          actions: [],
        },
      ],
    });

    expect(validateStory(story, snapshot).map((error) => error.code)).toContain(
      "non-finite-story-duration",
    );
    expect(() => storyDurationMs(story)).toThrow(/safe-integer timeline/i);
  });

  it.each([0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects the unrepresentable scene duration %s",
    (durationMs) => {
      const story = createStory({
        id: storyId("unsafe-scene"),
        title: "Unsafe scene",
        snapshotId: snapshot.id,
        scenes: [
          {
            id: sceneId("unsafe"),
            title: "Unsafe",
            durationMs,
            actions: [],
          },
        ],
      });

      expect(validateStory(story, snapshot)).toEqual([
        expect.objectContaining({ code: "unsafe-duration" }),
      ]);
    },
  );

  it("rejects a finite aggregate above the safe-integer timeline limit", () => {
    const story = createStory({
      id: storyId("unsafe-aggregate"),
      title: "Unsafe aggregate",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("long"),
          title: "Long",
          durationMs: Number.MAX_SAFE_INTEGER,
          actions: [],
        },
        { id: sceneId("last"), title: "Last", durationMs: 1, actions: [] },
      ],
    });

    expect(validateStory(story, snapshot)).toEqual([
      expect.objectContaining({ code: "unsafe-story-duration" }),
    ]);
    expect(() => storyDurationMs(story)).toThrow(/safe-integer timeline/i);
  });

  it("rejects same-target actions that conflict on one render channel", () => {
    const story = createStory({
      id: storyId("conflict"),
      title: "Conflict",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("conflict"),
          title: "Conflict",
          durationMs: 100,
          actions: [
            { type: "reveal", target: entityId("client") },
            { type: "hide", target: entityId("client") },
          ],
        },
      ],
    });

    expect(validateStory(story, snapshot)).toEqual([
      expect.objectContaining({ code: "conflicting-scene-action" }),
    ]);
  });
});
