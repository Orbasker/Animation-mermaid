import { describe, expect, it } from "vitest";

import { redactSpeedInsightEvent } from "@/app/_components/speed-insights";

describe("Speed Insights privacy filter", () => {
  it("retains only the pathname", () => {
    expect(
      redactSpeedInsightEvent({
        type: "vital",
        url: "https://example.test/editor?diagram=private#selection",
        route: "/editor",
      }),
    ).toEqual({ type: "vital", url: "/editor", route: "/editor" });
  });

  it("drops malformed URLs", () => {
    expect(
      redactSpeedInsightEvent({ type: "vital", url: "http://[invalid" }),
    ).toBeNull();
  });
});
