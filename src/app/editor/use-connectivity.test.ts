import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useConnectivity } from "./use-connectivity";

describe("useConnectivity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("tracks online/offline transitions and pauses AI when offline", () => {
    const { result } = renderHook(() => useConnectivity());
    expect(result.current.online).toBe(true);
    expect(result.current.aiAvailable).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.online).toBe(false);
    expect(result.current.aiAvailable).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.online).toBe(true);
    expect(result.current.aiAvailable).toBe(true);
  });

  it("flags an unsupported browser when a critical capability is missing", () => {
    const original = crypto.randomUUID;
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      undefined as unknown as typeof crypto.randomUUID,
    );
    // Force the probe to see a missing function.
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useConnectivity());
    expect(result.current.unsupportedBrowser).toBe(true);

    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: original,
    });
  });
});
