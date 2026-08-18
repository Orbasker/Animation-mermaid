import { describe, expect, it } from "vitest";

import { snapshotId } from "@/domain/graph";
import {
  ACCEPTANCE_FLOWCHART,
  STRESS_FLOWCHART,
  STRESS_FLOWCHART_NODE_COUNT,
  buildStressFlowchart,
} from "@/domain/mermaid/fixtures";
import { JobFailure, runImportLayoutJob } from "@/domain/mermaid/worker/job";
import type {
  ImportLayoutRequest,
  JobProgress,
} from "@/domain/mermaid/worker/protocol";

function request(
  text: string,
  overrides: Partial<ImportLayoutRequest> = {},
): ImportLayoutRequest {
  return {
    text,
    snapshotId: snapshotId("snap-current"),
    importedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

async function expectFailureCode(
  promise: Promise<unknown>,
  code: string,
): Promise<JobFailure> {
  const error = await promise.then(
    () => {
      throw new Error("expected the job to fail");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(JobFailure);
  expect((error as JobFailure).error.code).toBe(code);
  return error as JobFailure;
}

describe("runImportLayoutJob", () => {
  it("imports and lays out a valid flowchart, populating layout and stats", async () => {
    const result = await runImportLayoutJob(request(ACCEPTANCE_FLOWCHART));

    expect(result.snapshot.layout?.length).toBeGreaterThan(0);
    expect(result.snapshot.source.text).toBe(ACCEPTANCE_FLOWCHART);
    expect(result.stats.nodeCount).toBe(4);
    expect(result.stats.groupCount).toBe(1);
    expect(result.direction).toBe("TD");
    for (const hint of result.snapshot.layout ?? []) {
      expect(Number.isFinite(hint.x)).toBe(true);
      expect(Number.isFinite(hint.y)).toBe(true);
    }
  });

  it("lays out the large stress fixture off a single call", async () => {
    const result = await runImportLayoutJob(request(STRESS_FLOWCHART));
    expect(result.stats.nodeCount).toBe(STRESS_FLOWCHART_NODE_COUNT);
    expect(result.snapshot.layout?.length).toBeGreaterThanOrEqual(
      STRESS_FLOWCHART_NODE_COUNT,
    );
  });

  it("reports bounded, non-decreasing progress ending at 1", async () => {
    const seen: JobProgress[] = [];
    await runImportLayoutJob(request(ACCEPTANCE_FLOWCHART), {
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].ratio).toBe(0);
    expect(seen.at(-1)?.ratio).toBe(1);
    for (const progress of seen) {
      expect(progress.ratio).toBeGreaterThanOrEqual(0);
      expect(progress.ratio).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i].ratio).toBeGreaterThanOrEqual(seen[i - 1].ratio);
    }
  });

  it("rejects source over the byte limit before parsing", async () => {
    await expectFailureCode(
      runImportLayoutJob(
        request(ACCEPTANCE_FLOWCHART, { limits: { maxInputBytes: 4 } }),
      ),
      "input-too-large",
    );
  });

  it("rejects graphs over the node limit", async () => {
    await expectFailureCode(
      runImportLayoutJob(
        request(buildStressFlowchart(50), { limits: { maxNodes: 10 } }),
      ),
      "too-many-nodes",
    );
  });

  it("rejects graphs over the edge limit", async () => {
    await expectFailureCode(
      runImportLayoutJob(
        request(buildStressFlowchart(50), {
          limits: { maxNodes: 1_000, maxEdges: 5 },
        }),
      ),
      "too-many-edges",
    );
  });

  it("surfaces fatal parser diagnostics as an import-failed error", async () => {
    const failure = await expectFailureCode(
      runImportLayoutJob(request("not a flowchart at all")),
      "import-failed",
    );
    expect(failure.error.diagnostics?.length).toBeGreaterThan(0);
  });

  it("throws cancelled when its signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expectFailureCode(
      runImportLayoutJob(request(ACCEPTANCE_FLOWCHART), {
        signal: controller.signal,
      }),
      "cancelled",
    );
  });

  it("throws timeout when its signal aborts with a timeout reason", async () => {
    const controller = new AbortController();
    controller.abort("timeout");
    await expectFailureCode(
      runImportLayoutJob(request(ACCEPTANCE_FLOWCHART), {
        signal: controller.signal,
      }),
      "timeout",
    );
  });
});
