import { describe, expect, it } from "vitest";

import { renderStoryAt } from "@/domain";
import {
  createGraphSnapshot,
  entityId,
  snapshotId,
  type EntityId,
  type GraphSnapshot,
} from "@/domain/graph";
import { createStory, sceneId, storyId, type Story } from "@/domain/story";

const source = {
  diagramType: "flowchart",
  text: "flowchart LR\n  a[A] --> b[B]",
  importer: {
    importer: "test",
    importerVersion: "1.0.0",
    importedAt: "2026-08-18T00:00:00.000Z",
  },
} as const;

function graph(): GraphSnapshot {
  return createGraphSnapshot({
    id: snapshotId("seekable"),
    source,
    entities: [
      { kind: "node", id: entityId("a"), label: "A" },
      { kind: "node", id: entityId("b"), label: "B" },
      {
        kind: "edge",
        id: entityId("a->b"),
        source: entityId("a"),
        target: entityId("b"),
      },
    ],
  });
}

function story(): Story {
  return createStory({
    id: storyId("story"),
    title: "Seekable story",
    snapshotId: snapshotId("seekable"),
    scenes: [
      {
        id: sceneId("reveal-a"),
        title: "Reveal A",
        durationMs: 1000,
        actions: [
          { type: "reveal", target: entityId("a") },
          { type: "camera", focus: [entityId("a")] },
        ],
      },
      {
        id: sceneId("trace-edge"),
        title: "Trace the request",
        durationMs: 1000,
        actions: [
          { type: "reveal", target: entityId("b") },
          { type: "reveal", target: entityId("a->b") },
          { type: "trace", target: entityId("a->b") },
        ],
      },
    ],
  });
}

function effectsStory(): Story {
  return createStory({
    id: storyId("effects"),
    title: "Effects story",
    snapshotId: snapshotId("seekable"),
    scenes: [
      {
        id: sceneId("visible"),
        title: "Show the graph",
        durationMs: 1000,
        actions: [
          { type: "reveal", target: entityId("a") },
          { type: "reveal", target: entityId("b") },
          { type: "reveal", target: entityId("a->b") },
        ],
      },
      {
        id: sceneId("effects"),
        title: "Explain the change",
        durationMs: 1000,
        actions: [
          { type: "focus", target: entityId("a") },
          { type: "trace", target: entityId("a->b") },
          {
            type: "transform",
            target: entityId("b"),
            to: { translateX: 100, translateY: 40, scale: 1.2, rotateDeg: 10 },
          },
          { type: "compare", target: entityId("b"), change: "modified" },
          { type: "highlight", target: entityId("b"), style: "changed" },
          { type: "annotate", target: entityId("b"), text: "Schema changed" },
          { type: "camera", focus: [entityId("a"), entityId("b")] },
        ],
      },
    ],
  });
}

function storyWithZeroDurationAt(index: number): Story {
  const scenes = [
    {
      id: sceneId("first"),
      title: "First",
      durationMs: 100,
      actions: [{ type: "reveal" as const, target: entityId("a") }],
    },
    {
      id: sceneId("middle"),
      title: "Middle",
      durationMs: 100,
      actions: [{ type: "reveal" as const, target: entityId("b") }],
    },
    {
      id: sceneId("last"),
      title: "Last",
      durationMs: 100,
      actions: [{ type: "trace" as const, target: entityId("a->b") }],
    },
  ];
  scenes[index] = { ...scenes[index], durationMs: 0 };
  return createStory({
    id: storyId(`zero-${index}`),
    title: "Zero duration",
    snapshotId: snapshotId("seekable"),
    scenes,
  });
}

describe("renderStoryAt", () => {
  it("projects the same deterministic snapshot for the same timestamp", () => {
    const input = { snapshot: graph(), story: story(), timestampMs: 500 };

    const first = renderStoryAt(input);
    const refreshed = renderStoryAt({
      snapshot: graph(),
      story: story(),
      timestampMs: 500,
    });

    expect(first).toEqual(refreshed);
    expect(first).toMatchObject({
      timestampMs: 500,
      activeScene: { id: "reveal-a", progress: 0.5 },
      camera: { from: [], to: ["a"], progress: 0.5 },
    });
    expect(first.entities.find((entity) => entity.id === "a")?.opacity).toBe(
      0.5,
    );
  });

  it("projects focus, trace, transform, and compare effects through renderer-neutral values", () => {
    const state = renderStoryAt({
      snapshot: graph(),
      story: effectsStory(),
      timestampMs: 1500,
    });

    expect(
      state.entities.find((entity) => entity.id === entityId("a")),
    ).toMatchObject({
      focusProgress: 0.5,
    });
    expect(
      state.entities.find((entity) => entity.id === entityId("a->b")),
    ).toMatchObject({ traceProgress: 0.5 });
    expect(
      state.entities.find((entity) => entity.id === entityId("b")),
    ).toMatchObject({
      transform: {
        translateX: 50,
        translateY: 20,
        scale: 1.1,
        rotateDeg: 5,
      },
      comparison: "modified",
      highlightStyle: "changed",
      annotation: "Schema changed",
    });
    expect(state.camera).toEqual({
      from: [],
      to: [entityId("a"), entityId("b")],
      progress: 0.5,
    });
  });

  it("seeks directly and backward across scene boundaries without playback history", () => {
    const input = { snapshot: graph(), story: story() };
    const direct = renderStoryAt({ ...input, timestampMs: 1500 });

    renderStoryAt({ ...input, timestampMs: 1999 });
    renderStoryAt({ ...input, timestampMs: 250 });
    const afterArbitrarySeeks = renderStoryAt({ ...input, timestampMs: 1500 });
    const justAfterBoundary = renderStoryAt({ ...input, timestampMs: 1001 });
    const atBoundary = renderStoryAt({ ...input, timestampMs: 1000 });
    const justBeforeBoundary = renderStoryAt({ ...input, timestampMs: 999 });

    expect(afterArbitrarySeeks).toEqual(direct);
    expect(justAfterBoundary.activeScene).toMatchObject({
      id: sceneId("trace-edge"),
      progress: 0.001,
    });
    expect(
      justAfterBoundary.entities.find((entity) => entity.id === "a->b"),
    ).toMatchObject({ opacity: 0.001, traceProgress: 0.001 });
    expect(atBoundary.activeScene).toMatchObject({
      id: sceneId("trace-edge"),
      progress: 0,
    });
    expect(justBeforeBoundary.activeScene).toMatchObject({
      id: sceneId("reveal-a"),
      progress: 0.999,
    });
    expect(
      justBeforeBoundary.entities.find((entity) => entity.id === "a->b"),
    ).toMatchObject({ opacity: 0, traceProgress: 0 });
  });

  it.each([
    ["reduced", { reducedMotion: true }],
    ["static", { staticFallback: true }],
  ] as const)(
    "%s playback communicates the scene while snapping spatial effects",
    (motionMode, preferences) => {
      const state = renderStoryAt({
        snapshot: graph(),
        story: effectsStory(),
        timestampMs: 1000,
        preferences,
      });

      expect(state).toMatchObject({
        motionMode,
        transitionProgress: 1,
        activeScene: {
          id: sceneId("effects"),
          title: "Explain the change",
          progress: 0,
        },
        camera: {
          from: [entityId("a"), entityId("b")],
          to: [entityId("a"), entityId("b")],
          progress: 1,
        },
        communication: {
          sceneTitle: "Explain the change",
        },
      });
      expect(state.communication?.descriptions).toEqual(
        expect.arrayContaining([
          "Focus on A",
          "Trace A to B",
          "Transform B",
          "Compare B: modified",
        ]),
      );
      expect(
        state.entities.find((entity) => entity.id === entityId("a")),
      ).toMatchObject({ focusProgress: 1 });
      expect(
        state.entities.find((entity) => entity.id === entityId("a->b")),
      ).toMatchObject({ traceProgress: 1 });
      expect(
        state.entities.find((entity) => entity.id === entityId("b")),
      ).toMatchObject({
        transform: {
          translateX: 100,
          translateY: 40,
          scale: 1.2,
          rotateDeg: 10,
        },
        comparison: "modified",
      });
    },
  );

  it("names self-referential edges without recursive communication lookup", () => {
    const snapshot = createGraphSnapshot({
      id: snapshotId("cyclic"),
      source,
      entities: [
        {
          kind: "edge",
          id: entityId("loop"),
          source: entityId("loop"),
          target: entityId("loop"),
        },
      ],
    });
    const cyclicStory = createStory({
      id: storyId("cyclic"),
      title: "Cyclic",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("trace"),
          title: "Trace cycle",
          durationMs: 100,
          actions: [{ type: "trace", target: entityId("loop") }],
        },
      ],
    });

    const state = renderStoryAt({
      snapshot,
      story: cyclicStory,
      timestampMs: 50,
    });

    expect(state.communication?.descriptions).toContain("Trace loop to loop");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects the non-finite timestamp %s",
    (timestampMs) => {
      expect(() =>
        renderStoryAt({ snapshot: graph(), story: story(), timestampMs }),
      ).toThrow(/timestampMs must be finite/);
    },
  );

  it("rejects story and snapshot mismatches at the public render seam", () => {
    const mismatched = createStory({
      id: storyId("mismatch"),
      title: "Mismatch",
      snapshotId: snapshotId("other"),
      scenes: [],
    });

    expect(() =>
      renderStoryAt({ snapshot: graph(), story: mismatched, timestampMs: 0 }),
    ).toThrow(/targets snapshot.*other.*seekable/i);
  });

  it("rejects actions whose target is absent from the snapshot", () => {
    const missingTarget = createStory({
      id: storyId("missing-target"),
      title: "Missing target",
      snapshotId: snapshotId("seekable"),
      scenes: [
        {
          id: sceneId("missing"),
          title: "Missing",
          durationMs: 100,
          actions: [{ type: "reveal", target: entityId("ghost") }],
        },
      ],
    });

    expect(() =>
      renderStoryAt({
        snapshot: graph(),
        story: missingTarget,
        timestampMs: 0,
      }),
    ).toThrow(/unknown entity.*ghost/i);
  });

  it("isolates returned transforms and camera arrays from inputs and later renders", () => {
    const authoredStory = story();
    const first = renderStoryAt({
      snapshot: graph(),
      story: authoredStory,
      timestampMs: 500,
    });

    (first.entities[0].transform as { translateX: number }).translateX = 999;
    (first.camera.to as EntityId[])[0] = entityId("mutated");

    const cameraAction = authoredStory.scenes[0].actions.find(
      (action) => action.type === "camera",
    );
    const second = renderStoryAt({
      snapshot: graph(),
      story: authoredStory,
      timestampMs: 500,
    });

    expect(cameraAction?.type === "camera" ? cameraAction.focus : []).toEqual([
      entityId("a"),
    ]);
    expect(second.entities[0].transform.translateX).toBe(0);
    expect(second.camera.to).toEqual([entityId("a")]);
  });

  it.each([0, 1, 2])("rejects a zero-duration scene at index %s", (index) => {
    expect(() =>
      renderStoryAt({
        snapshot: graph(),
        story: storyWithZeroDurationAt(index),
        timestampMs: 0,
      }),
    ).toThrow(/zero duration/i);
  });

  it("rejects conflicting same-channel actions on one target", () => {
    const conflicting = createStory({
      id: storyId("conflict"),
      title: "Conflict",
      snapshotId: snapshotId("seekable"),
      scenes: [
        {
          id: sceneId("conflict"),
          title: "Conflict",
          durationMs: 100,
          actions: [
            { type: "reveal", target: entityId("a") },
            { type: "hide", target: entityId("a") },
          ],
        },
      ],
    });

    expect(() =>
      renderStoryAt({ snapshot: graph(), story: conflicting, timestampMs: 50 }),
    ).toThrow(/conflicting.*visibility.*a/i);
  });

  it("rejects invalid graph snapshots before duplicate ids collapse in projection maps", () => {
    const duplicateGraph = createGraphSnapshot({
      id: snapshotId("seekable"),
      source,
      entities: [
        { kind: "node", id: entityId("a"), label: "First A" },
        { kind: "node", id: entityId("a"), label: "Second A" },
      ],
    });

    expect(() =>
      renderStoryAt({
        snapshot: duplicateGraph,
        story: createStory({
          id: storyId("duplicate-graph"),
          title: "Duplicate graph",
          snapshotId: duplicateGraph.id,
          scenes: [],
        }),
        timestampMs: 0,
      }),
    ).toThrow(/duplicate entity id.*a/i);

    try {
      renderStoryAt({
        snapshot: duplicateGraph,
        story: createStory({
          id: storyId("duplicate-graph"),
          title: "Duplicate graph",
          snapshotId: duplicateGraph.id,
          scenes: [],
        }),
        timestampMs: 0,
      });
    } catch (error) {
      expect(error).toMatchObject({
        issues: [
          expect.objectContaining({
            scope: "snapshot",
            code: "duplicate-entity-id",
          }),
        ],
      });
    }
  });

  it("rejects malformed runtime actions with a controlled structural issue", () => {
    const malformed = createStory({
      id: storyId("malformed"),
      title: "Malformed",
      snapshotId: snapshotId("seekable"),
      scenes: [
        {
          id: sceneId("malformed"),
          title: "Malformed",
          durationMs: 100,
          actions: [{ type: "unknown", target: "a" }] as never,
        },
      ],
    });

    expect(() =>
      renderStoryAt({ snapshot: graph(), story: malformed, timestampMs: 0 }),
    ).toThrow(/story\.scenes\[0\]\.actions\[0\].*unsupported action type/i);
  });

  it("uses overflow-resistant interpolation for opposite finite extremes", () => {
    const extremeStory = createStory({
      id: storyId("extreme-transform"),
      title: "Extreme transform",
      snapshotId: snapshotId("seekable"),
      scenes: [
        {
          id: sceneId("negative"),
          title: "Negative",
          durationMs: 1,
          actions: [
            {
              type: "transform",
              target: entityId("a"),
              to: {
                translateX: -Number.MAX_VALUE,
                translateY: 0,
                scale: 1,
                rotateDeg: 0,
              },
            },
          ],
        },
        {
          id: sceneId("positive"),
          title: "Positive",
          durationMs: 1,
          actions: [
            {
              type: "transform",
              target: entityId("a"),
              to: {
                translateX: Number.MAX_VALUE,
                translateY: 0,
                scale: 1,
                rotateDeg: 0,
              },
            },
          ],
        },
      ],
    });

    const samples = [1, 1.25, 1.5, 1.75, 2].map((timestampMs) =>
      renderStoryAt({ snapshot: graph(), story: extremeStory, timestampMs }),
    );

    for (const state of samples) {
      const transformed = state.entities.find(
        (entity) => entity.id === entityId("a"),
      );
      expect(
        [
          state.timestampMs,
          state.durationMs,
          state.transitionProgress,
          transformed?.transform.translateX,
          transformed?.transform.translateY,
          transformed?.transform.scale,
          transformed?.transform.rotateDeg,
        ].every((value) => typeof value === "number" && Number.isFinite(value)),
      ).toBe(true);
    }
    expect(
      samples[2].entities.find((entity) => entity.id === entityId("a"))
        ?.transform.translateX,
    ).toBe(0);
  });

  it("rejects aggregate story-duration overflow before producing render state", () => {
    const overflow = createStory({
      id: storyId("duration-overflow"),
      title: "Duration overflow",
      snapshotId: snapshotId("seekable"),
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

    expect(() =>
      renderStoryAt({ snapshot: graph(), story: overflow, timestampMs: 0 }),
    ).toThrow(/aggregate duration.*finite/i);
  });

  it("addresses a final one-millisecond scene at the safe timeline limit", () => {
    const boundaryStory = createStory({
      id: storyId("safe-boundary"),
      title: "Safe boundary",
      snapshotId: snapshotId("seekable"),
      scenes: [
        {
          id: sceneId("long"),
          title: "Long",
          durationMs: Number.MAX_SAFE_INTEGER - 1,
          actions: [],
        },
        {
          id: sceneId("final-millisecond"),
          title: "Final millisecond",
          durationMs: 1,
          actions: [{ type: "reveal", target: entityId("a") }],
        },
      ],
    });

    const state = renderStoryAt({
      snapshot: graph(),
      story: boundaryStory,
      timestampMs: Number.MAX_SAFE_INTEGER,
    });

    expect(state.durationMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(state.activeScene).toMatchObject({
      id: sceneId("final-millisecond"),
      startedAtMs: Number.MAX_SAFE_INTEGER - 1,
      durationMs: 1,
      progress: 1,
    });
    expect(
      state.entities.find((entity) => entity.id === entityId("a")),
    ).toMatchObject({ opacity: 1, visible: true });
  });
});
