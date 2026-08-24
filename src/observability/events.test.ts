import { describe, expect, it } from "vitest";

import {
  createClientErrorEvent,
  createObservabilityRecord,
  createServerErrorEvent,
  createWebVitalEvent,
} from "@/observability/events";
import { clientObservabilityEventSchema } from "@/observability/schema";

describe("privacy-safe observability events", () => {
  it("classifies browser errors without retaining content-bearing fields", () => {
    const error = new TypeError("diagram text: customer@example.com");
    error.stack = "https://example.test/editor?project=secret";

    expect(createClientErrorEvent("window", error)).toEqual({
      type: "client_error",
      source: "window",
      errorClass: "TypeError",
    });
  });

  it("accepts only the allowlisted Web Vital fields", () => {
    expect(
      createWebVitalEvent({
        name: "LCP",
        value: 1823.456,
        delta: 123.456,
        rating: "needs-improvement",
        navigationType: "navigate",
      }),
    ).toEqual({
      type: "web_vital",
      name: "LCP",
      value: 1823,
      delta: 123,
      rating: "needs-improvement",
      navigationType: "navigate",
    });
  });

  it.each([
    { message: "private diagram" },
    { stack: "at /editor?project=private" },
    { url: "https://example.test/editor?project=private" },
    { project: { mermaid: "flowchart TD" } },
  ])("rejects a content-bearing extra field: %o", (extra) => {
    expect(
      clientObservabilityEventSchema.safeParse({
        type: "client_error",
        source: "window",
        errorClass: "Error",
        ...extra,
      }).success,
    ).toBe(false);
  });

  it("enriches every production record with release, environment, and feature", () => {
    expect(
      createObservabilityRecord(
        createClientErrorEvent("unhandled_rejection", "private reason"),
        {
          release: "abc123",
          environment: "production",
        },
        "editor",
        "anonymous-client",
      ),
    ).toEqual({
      schemaVersion: 1,
      feature: "editor",
      trust: "anonymous-client",
      release: "abc123",
      environment: "production",
      type: "client_error",
      source: "unhandled_rejection",
      errorClass: "NonError",
    });
  });

  it.each([
    { name: "LCP", value: 120_001, delta: 1 },
    { name: "INP", value: 1, delta: -1 },
    { name: "CLS", value: 101, delta: 0.1 },
  ])("rejects an implausible Web Vital: %o", (metric) => {
    expect(
      clientObservabilityEventSchema.safeParse({
        type: "web_vital",
        ...metric,
        rating: "poor",
        navigationType: "navigate",
      }).success,
    ).toBe(false);
  });

  it("uses route templates and error classes for server errors", () => {
    expect(
      createServerErrorEvent(new Error("private input"), {
        routerKind: "App Router",
        routePath: "/api/observability",
        routeType: "route",
      }),
    ).toEqual({
      type: "server_error",
      errorClass: "Error",
      routerKind: "App Router",
      routePath: "/api/observability",
      routeType: "route",
    });
  });
});
