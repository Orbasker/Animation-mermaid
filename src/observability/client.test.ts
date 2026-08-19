import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportClientObservabilityEvent } from "@/observability/client";
import { createClientErrorEvent } from "@/observability/events";

beforeEach(() => {
  document.head.innerHTML =
    '<meta name="observability-token" content="signed-release-token">';
});

afterEach(() => {
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("client observability transport", () => {
  it("sends an allowlisted event in the signed same-origin envelope", () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });

    reportClientObservabilityEvent(
      createClientErrorEvent(
        "window",
        new Error("flowchart TD; secret --> content"),
      ),
    );

    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/observability",
      JSON.stringify({
        token: "signed-release-token",
        event: {
          type: "client_error",
          source: "window",
          errorClass: "Error",
        },
      }),
    );
  });

  it("falls back when sendBeacon throws synchronously", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("beacon unavailable");
      }),
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchMock);

    expect(() =>
      reportClientObservabilityEvent(
        createClientErrorEvent("window", new Error("private")),
      ),
    ).not.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("swallows synchronous fetch failures", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => false),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch unavailable");
      }),
    );

    expect(() =>
      reportClientObservabilityEvent(
        createClientErrorEvent("window", new Error("private")),
      ),
    ).not.toThrow();
  });

  it("handles rejected fetches without an unhandled rejection", async () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => false),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    reportClientObservabilityEvent(
      createClientErrorEvent("window", new Error("private")),
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  it("swallows serialization failures", () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    const event = {
      get type(): "client_error" {
        throw new Error("serialization failed");
      },
      source: "window" as const,
      errorClass: "Error" as const,
    };

    expect(() => reportClientObservabilityEvent(event)).not.toThrow();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("drops recursive reports raised by the transport", () => {
    const sendBeacon = vi.fn(() => {
      reportClientObservabilityEvent(
        createClientErrorEvent("window", new Error("recursive")),
      );
      return true;
    });
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });

    reportClientObservabilityEvent(
      createClientErrorEvent("window", new Error("original")),
    );

    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("does nothing when the server did not issue a token", () => {
    document.head.innerHTML = "";
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });

    reportClientObservabilityEvent(
      createClientErrorEvent("window", new Error("private")),
    );

    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
