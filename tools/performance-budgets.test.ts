import { describe, expect, it } from "vitest";

import budgets from "./performance-budgets.json";

describe("performance budgets", () => {
  it("defines positive ceilings for every release gate", () => {
    expect(budgets).toEqual({
      bundle: {
        emittedJavaScriptBytes: 2_600_000,
        largestJavaScriptChunkBytes: 1_600_000,
        editorRouteJavaScriptBytes: 2_300_000,
      },
      browser: {
        editorReadyMs: 4_000,
        coldSurfaceInteractionMs: 750,
        warmSurfaceInteractionMs: 750,
        canvas200RenderMs: 3_000,
      },
      export: {
        sampleHtmlBytes: 32_000,
        denseHtmlBytes: 100_000,
        sampleProjectJsonBytes: 6_000,
        denseProjectJsonBytes: 80_000,
      },
    });
  });
});
