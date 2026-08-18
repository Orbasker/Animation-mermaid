import { describe, expect, it } from "vitest";

import { parseShareRef } from "./share-ref";

describe("parseShareRef", () => {
  const id = `rev_${"a1b2c3d4".repeat(4)}`;

  it("reads a bare share code", () => {
    expect(parseShareRef(id)).toBe(id);
  });

  it("reads a share code out of a mention", () => {
    expect(parseShareRef(`<@U0BOT> what changed in ${id} exactly?`)).toBe(id);
  });

  it("reads a share code out of a URL", () => {
    expect(parseShareRef(`see https://example.com/review-share/${id}`)).toBe(
      id,
    );
  });

  it("returns null when no share code is present", () => {
    expect(parseShareRef("<@U0BOT> hello there")).toBeNull();
    expect(parseShareRef("rev_not-a-valid-code")).toBeNull();
  });
});
