import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/observability/route";
import { deploymentIdentity } from "@/observability/deployment";
import { issueTelemetryToken } from "@/observability/integrity";

const originalRelease = process.env.OBSERVABILITY_RELEASE;
const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA;
const originalDeployment = process.env.VERCEL_DEPLOYMENT_ID;
const originalEnvironment = process.env.VERCEL_ENV;
const originalSecret = process.env.OBSERVABILITY_INGEST_SECRET;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.restoreAllMocks();
  restore("OBSERVABILITY_RELEASE", originalRelease);
  restore("VERCEL_GIT_COMMIT_SHA", originalCommit);
  restore("VERCEL_DEPLOYMENT_ID", originalDeployment);
  restore("VERCEL_ENV", originalEnvironment);
  restore("OBSERVABILITY_INGEST_SECRET", originalSecret);
});

function browserHeaders(extra: Record<string, string> = {}) {
  return {
    origin: "https://example.test",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    ...extra,
  };
}

function signedBody(event: unknown): string {
  const deployment = deploymentIdentity();
  if (!deployment) throw new Error("deployment identity unavailable");
  const token = issueTelemetryToken(deployment);
  if (!token) throw new Error("telemetry token unavailable");
  return JSON.stringify({ token, event });
}

describe("POST /api/observability", () => {
  it("logs a validated, release-bound event", async () => {
    process.env.OBSERVABILITY_RELEASE = "release-21";
    process.env.VERCEL_ENV = "production";
    process.env.OBSERVABILITY_INGEST_SECRET =
      "test-ingest-secret-at-least-32-bytes";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://example.test/api/observability?private=value", {
        method: "POST",
        headers: browserHeaders(),
        body: signedBody({
          type: "web_vital",
          name: "INP",
          value: 123,
          delta: 23,
          rating: "good",
          navigationType: "navigate",
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      feature: "editor",
      trust: "anonymous-client",
      release: "release-21",
      environment: "production",
      type: "web_vital",
      name: "INP",
      value: 123,
      delta: 23,
      rating: "good",
      navigationType: "navigate",
    });
  });

  it.each([
    ["missing Origin", { origin: "" }],
    ["cross-origin Origin", { origin: "https://attacker.test" }],
    ["cross-site Fetch Metadata", { "sec-fetch-site": "cross-site" }],
  ])("rejects %s", async (_name, changedHeader) => {
    const response = await POST(
      new Request("https://example.test/api/observability", {
        method: "POST",
        headers: browserHeaders(changedHeader),
        body: signedBody({
          type: "client_error",
          source: "window",
          errorClass: "Error",
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("rejects a token signed for another release", async () => {
    process.env.OBSERVABILITY_RELEASE = "old-release";
    const body = signedBody({
      type: "client_error",
      source: "window",
      errorClass: "Error",
    });
    process.env.OBSERVABILITY_RELEASE = "new-release";

    const response = await POST(
      new Request("https://example.test/api/observability", {
        method: "POST",
        headers: browserHeaders(),
        body,
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects content-bearing fields without logging them", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await POST(
      new Request("https://example.test/api/observability", {
        method: "POST",
        headers: browserHeaders(),
        body: signedBody({
          type: "client_error",
          source: "window",
          errorClass: "Error",
          message: "private diagram content",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(info).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body after the byte limit", async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1_100));
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: browserHeaders(),
      body: stream,
      duplex: "half",
    };

    const response = await POST(
      new Request("https://example.test/api/observability", init),
    );

    expect(response.status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it("uses VERCEL_DEPLOYMENT_ID when commit and explicit release are absent", async () => {
    delete process.env.OBSERVABILITY_RELEASE;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_123";
    process.env.VERCEL_ENV = "production";
    process.env.OBSERVABILITY_INGEST_SECRET =
      "test-ingest-secret-at-least-32-bytes";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(
      new Request("https://example.test/api/observability", {
        method: "POST",
        headers: browserHeaders(),
        body: signedBody({
          type: "client_error",
          source: "window",
          errorClass: "Error",
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(String(info.mock.calls[0]?.[0])).toContain('"release":"dpl_123"');
  });
});
