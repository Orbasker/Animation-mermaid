import { describe, expect, it } from "vitest";

import { sampleProjectDocument } from "@/domain/fixtures";
import { renderStoryAt, type StoryRenderState } from "@/domain/story-engine";
import { storyId } from "@/domain/story";
import type { GraphSnapshot } from "@/domain/graph";
import type { Story } from "@/domain/story";
import {
  buildExportPayload,
  type ExportPayload,
} from "@/export/export-payload";
import { RENDER_FUNCTION_SOURCE } from "@/export/player-runtime";

type Mode = "full" | "reduced" | "static";
type ExportedRenderFn = (
  payload: ExportPayload,
  timestampMs: number,
  mode: Mode,
) => Omit<StoryRenderState, "communication">;

/**
 * Evaluates the *exact* source string shipped inside every export and returns its render
 * function. Running the same text the browser runs is what makes the equivalence assertion
 * below meaningful: there is no compiled copy that could drift from what reviewers execute.
 */
function loadExportedRenderer(): ExportedRenderFn {
  const factory = new Function(
    `${RENDER_FUNCTION_SOURCE}\nreturn renderExportedStoryAt;`,
  );
  return factory() as ExportedRenderFn;
}

function preferencesFor(mode: Mode) {
  switch (mode) {
    case "full":
      return undefined;
    case "reduced":
      return { reducedMotion: true };
    case "static":
      return { staticFallback: true };
  }
}

function visualSubset(
  state: StoryRenderState,
): Omit<StoryRenderState, "communication"> {
  const clone: { communication?: unknown } & Record<string, unknown> = {
    ...state,
  };
  delete clone.communication;
  return clone as unknown as Omit<StoryRenderState, "communication">;
}

describe("exported player render fidelity", () => {
  const project = sampleProjectDocument();
  const payload = buildExportPayload(project, storyId("story-walkthrough"));
  const story = project.stories.find(
    (candidate) => candidate.id === storyId("story-walkthrough"),
  ) as Story;
  const snapshot = project.snapshots.find(
    (candidate) => candidate.id === story.snapshotId,
  ) as GraphSnapshot;
  const render = loadExportedRenderer();
  const duration = payload.story.scenes.reduce(
    (total, scene) => total + scene.durationMs,
    0,
  );

  const boundaries = [0, 1000, 1001, 2500, 3700];
  const steps = Array.from({ length: 41 }, (_, index) =>
    Math.round((duration * index) / 40),
  );
  const outOfRange = [-500, duration + 2000];
  const timestamps = [...new Set([...boundaries, ...steps, ...outOfRange])];
  const modes: readonly Mode[] = ["full", "reduced", "static"];

  for (const mode of modes) {
    it(`matches the domain engine at sampled timestamps (${mode})`, () => {
      for (const timestampMs of timestamps) {
        const engine = renderStoryAt({
          snapshot,
          story,
          timestampMs,
          preferences: preferencesFor(mode),
        });
        const exported = render(payload, timestampMs, mode);
        expect(exported).toEqual(visualSubset(engine));
      }
    });
  }

  it("clamps out-of-range timestamps to the story bounds", () => {
    expect(render(payload, -1, "full").timestampMs).toBe(0);
    expect(render(payload, duration + 999, "full").timestampMs).toBe(duration);
  });

  it("rejects a non-finite timestamp", () => {
    expect(() => render(payload, Number.NaN, "full")).toThrow();
  });
});
