import { afterEach, describe, expect, it, vi } from "vitest";

import { snapshotId } from "@/domain/graph";
import {
  ACCEPTANCE_FLOWCHART,
  buildStressFlowchart,
} from "@/domain/mermaid/fixtures";
import { JobFailure } from "@/domain/mermaid/worker/job";
import { MermaidImportRunner } from "@/domain/mermaid/worker/runner";
import type {
  ImportLayoutRequest,
  ImportLayoutResult,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from "@/domain/mermaid/worker/protocol";

function request(
  overrides: Partial<ImportLayoutRequest> = {},
): ImportLayoutRequest {
  return {
    text: ACCEPTANCE_FLOWCHART,
    snapshotId: snapshotId("snap-current"),
    importedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

/** A controllable stand-in for a real Web Worker, so message flow can be driven by hand. */
class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerOutboundMessage>) => void) | null =
    null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: WorkerInboundMessage[] = [];
  terminated = false;

  postMessage(message: WorkerInboundMessage): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }

  emit(message: WorkerOutboundMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerOutboundMessage>);
  }
  crash(message: string): void {
    this.onerror?.({ message });
  }
  get requestId(): number {
    return (this.posted[0] as { requestId: number }).requestId;
  }
}

function fakeResult(): ImportLayoutResult {
  return {
    snapshot: {
      schemaVersion: 1,
      id: snapshotId("snap-current"),
      source: {
        diagramType: "flowchart",
        text: ACCEPTANCE_FLOWCHART,
        importer: {
          importer: "mermaid-flowchart",
          importerVersion: "0.1.0",
          importedAt: "2026-08-18T00:00:00.000Z",
        },
      },
      entities: [],
      layout: [],
    },
    diagnostics: [],
    direction: "TD",
    stats: { nodeCount: 4, edgeCount: 3, groupCount: 1 },
  } as unknown as ImportLayoutResult;
}

async function rejectionOf(promise: Promise<unknown>): Promise<JobFailure> {
  const caught = await promise.then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(JobFailure);
  return caught as JobFailure;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MermaidImportRunner (worker path)", () => {
  function workerRunner(overrides = {}) {
    const workers: FakeWorker[] = [];
    const runner = new MermaidImportRunner({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
      ...overrides,
    });
    return { runner, workers };
  }

  it("reports it is using a worker and resolves on a matching result", async () => {
    const { runner, workers } = workerRunner();
    expect(runner.usingWorker).toBe(true);

    const handle = runner.run(request());
    const worker = workers[0];
    worker.emit({
      kind: "result",
      requestId: worker.requestId,
      result: fakeResult(),
    });

    const result = await handle.promise;
    expect(result.stats.nodeCount).toBe(4);
    expect(worker.terminated).toBe(true);
  });

  it("supersedes an in-flight request: cancels it, terminates its worker, and ignores its stale result", async () => {
    const { runner, workers } = workerRunner();
    const first = runner.run(request());
    const firstWorker = workers[0];

    const second = runner.run(request({ text: buildStressFlowchart(4) }));
    const secondWorker = workers[1];

    expect(firstWorker.terminated).toBe(true);
    const failure = await rejectionOf(first.promise);
    expect(failure.error.code).toBe("cancelled");

    // A late/stale message from the superseded worker must not settle the new request.
    firstWorker.emit({
      kind: "result",
      requestId: firstWorker.requestId,
      result: fakeResult(),
    });

    secondWorker.emit({
      kind: "result",
      requestId: secondWorker.requestId,
      result: fakeResult(),
    });
    await expect(second.promise).resolves.toBeTruthy();
  });

  it("cancel() rejects with a cancellation and terminates the worker", async () => {
    const { runner, workers } = workerRunner();
    const handle = runner.run(request());
    handle.cancel();

    expect(workers[0].terminated).toBe(true);
    const failure = await rejectionOf(handle.promise);
    expect(failure.error.code).toBe("cancelled");
  });

  it("turns a worker crash into a recoverable worker-error", async () => {
    const { runner, workers } = workerRunner();
    const handle = runner.run(request());
    workers[0].crash("boom");

    const failure = await rejectionOf(handle.promise);
    expect(failure.error.code).toBe("worker-error");
    expect(failure.error.message).toContain("boom");
    expect(workers[0].terminated).toBe(true);
  });

  it("forwards a worker error message verbatim", async () => {
    const { runner, workers } = workerRunner();
    const handle = runner.run(request());
    const worker = workers[0];
    worker.emit({
      kind: "error",
      requestId: worker.requestId,
      error: { code: "layout-failed", message: "elk exploded" },
    });

    const failure = await rejectionOf(handle.promise);
    expect(failure.error.code).toBe("layout-failed");
  });

  it("only forwards progress for the active request", () => {
    const { runner, workers } = workerRunner();
    const seen: number[] = [];
    const firstHandle = runner.run(request(), (progress) =>
      seen.push(progress.ratio),
    );
    firstHandle.promise.catch(() => {});
    const first = workers[0];
    // Supersede, then have the old worker emit progress — it must be dropped.
    const secondHandle = runner.run(request());
    secondHandle.promise.catch(() => {});
    first.emit({
      kind: "progress",
      requestId: first.requestId,
      progress: { phase: "layout", ratio: 0.5, message: "late" },
    });
    expect(seen).toEqual([]);
  });

  it("times out a silent worker, terminating it with a timeout error", async () => {
    vi.useFakeTimers();
    const { runner, workers } = workerRunner();
    const handle = runner.run(request({ limits: { timeoutMs: 1_000 } }));

    vi.advanceTimersByTime(1_001);

    const failure = await rejectionOf(handle.promise);
    expect(failure.error.code).toBe("timeout");
    expect(workers[0].terminated).toBe(true);
  });

  it("falls back to inline when the worker factory throws", async () => {
    const runner = new MermaidImportRunner({
      createWorker: () => {
        throw new Error("no worker here");
      },
    });
    const result = await runner.run(request()).promise;
    expect(result.snapshot.layout?.length).toBeGreaterThan(0);
  });
});

describe("MermaidImportRunner (inline fallback)", () => {
  it("runs on the main thread when no worker is available", async () => {
    const runner = new MermaidImportRunner({ createWorker: null });
    expect(runner.usingWorker).toBe(false);

    const result = await runner.run(request()).promise;
    expect(result.snapshot.source.text).toBe(ACCEPTANCE_FLOWCHART);
    expect(result.snapshot.layout?.length).toBeGreaterThan(0);
  });

  it("enforces limits on the inline path", async () => {
    const runner = new MermaidImportRunner({ createWorker: null });
    const failure = await rejectionOf(
      runner.run(
        request({ text: buildStressFlowchart(50), limits: { maxNodes: 5 } }),
      ).promise,
    );
    expect(failure.error.code).toBe("too-many-nodes");
  });

  it("supersedes an inline request with a cancellation", async () => {
    const runner = new MermaidImportRunner({ createWorker: null });
    const first = runner.run(request());
    runner.run(request());
    const failure = await rejectionOf(first.promise);
    expect(failure.error.code).toBe("cancelled");
  });

  it("dispose() cancels any in-flight request", async () => {
    const runner = new MermaidImportRunner({ createWorker: null });
    const handle = runner.run(request());
    runner.dispose();
    const failure = await rejectionOf(handle.promise);
    expect(failure.error.code).toBe("cancelled");
  });
});
