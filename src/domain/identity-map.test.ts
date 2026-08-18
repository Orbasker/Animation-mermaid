import { describe, expect, it } from "vitest";

import {
  confirmIdentity,
  EMPTY_IDENTITY_MAP,
  isConfirmed,
  isRejected,
  rejectIdentity,
} from "@/domain/identity-map";
import { entityId } from "@/domain/graph";

const a = entityId("a");
const b = entityId("b");

describe("identity map", () => {
  it("confirms a pair idempotently", () => {
    const once = confirmIdentity(EMPTY_IDENTITY_MAP, a, b);
    const twice = confirmIdentity(once, a, b);
    expect(twice.confirmed).toHaveLength(1);
    expect(isConfirmed(twice, a, b)).toBe(true);
  });

  it("rejecting a confirmed pair moves it, and confirming flips it back", () => {
    const confirmed = confirmIdentity(EMPTY_IDENTITY_MAP, a, b);
    const rejected = rejectIdentity(confirmed, a, b);
    expect(isConfirmed(rejected, a, b)).toBe(false);
    expect(isRejected(rejected, a, b)).toBe(true);

    const reconfirmed = confirmIdentity(rejected, a, b);
    expect(isConfirmed(reconfirmed, a, b)).toBe(true);
    expect(isRejected(reconfirmed, a, b)).toBe(false);
  });

  it("does not mutate the input map", () => {
    confirmIdentity(EMPTY_IDENTITY_MAP, a, b);
    expect(EMPTY_IDENTITY_MAP.confirmed).toEqual([]);
  });
});
