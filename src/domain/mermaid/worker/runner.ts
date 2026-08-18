import { JobFailure, runImportLayoutJob } from "@/domain/mermaid/worker/job";
import {
  resolveJobLimits,
  type ImportLayoutRequest,
  type ImportLayoutResult,
  type JobError,
  type JobProgress,
  type MermaidJobLimits,
  type WorkerOutboundMessage,
} from "@/domain/mermaid/worker/protocol";

/** Creates a fresh worker. Injected in tests; the default targets {@link worker-entry}. */
export type WorkerFactory = () => Worker;

/** The inline job runner, injected so the fallback path can be driven in tests. */
export type InlineRunner = typeof runImportLayoutJob;

export interface MermaidImportRunnerOptions {
  /**
   * Factory for the Web Worker, or `null` to force the inline fallback. Defaults to a real
   * module worker when the environment provides `Worker`, and to the inline path otherwise.
   */
  readonly createWorker?: WorkerFactory | null;
  /** The inline runner used when no worker is available. Defaults to {@link runImportLayoutJob}. */
  readonly runInline?: InlineRunner;
  /** Baseline limits for every request; a request may still override a subset. */
  readonly limits?: Partial<MermaidJobLimits>;
}

/** A running (or completed) request. `cancel` abandons it; `promise` settles once. */
export interface RunHandle {
  readonly requestId: number;
  readonly promise: Promise<ImportLayoutResult>;
  cancel(): void;
}

interface ActiveRequest {
  readonly requestId: number;
  readonly reject: (error: JobFailure) => void;
  readonly resolve: (result: ImportLayoutResult) => void;
  settled: boolean;
  readonly cleanup: () => void;
}

/**
 * Builds the default worker factory: a module worker over {@link worker-entry}, or `null` when
 * the runtime has no `Worker` (server render, jsdom, older environments) so the runner falls
 * back to the main thread.
 */
export function defaultWorkerFactory(): WorkerFactory | null {
  if (typeof Worker === "undefined") return null;
  return () =>
    new Worker(new URL("./worker-entry.ts", import.meta.url), {
      type: "module",
    });
}

const TIMEOUT_ERROR: JobError = {
  code: "timeout",
  message: "The diagram took too long to import and lay out.",
};

function supersededError(): JobError {
  return { code: "cancelled", message: "The import was superseded." };
}

function cancelledError(): JobError {
  return { code: "cancelled", message: "The import was cancelled." };
}

/**
 * Coordinates cancellable, single-in-flight Mermaid import+layout jobs. At most one request
 * runs at a time: a new {@link run} supersedes any predecessor, terminating its worker so its
 * CPU work stops immediately, and every inbound message is matched against the current
 * `requestId` so a superseded job's result can never be applied. When no `Worker` is available
 * it runs the identical job on the main thread with cooperative cancellation instead.
 */
export class MermaidImportRunner {
  #seq = 0;
  #active: ActiveRequest | null = null;
  readonly #createWorker: WorkerFactory | null;
  readonly #runInline: InlineRunner;
  readonly #limits: Partial<MermaidJobLimits> | undefined;

  constructor(options: MermaidImportRunnerOptions = {}) {
    this.#createWorker =
      options.createWorker === undefined
        ? defaultWorkerFactory()
        : options.createWorker;
    this.#runInline = options.runInline ?? runImportLayoutJob;
    this.#limits = options.limits;
  }

  /** Whether jobs run in a real Web Worker (`true`) or on the main thread (`false`). */
  get usingWorker(): boolean {
    return this.#createWorker !== null;
  }

  /**
   * Starts an import+layout, superseding any in-flight request. The returned promise resolves
   * with the laid-out result, or rejects with a {@link JobFailure}; a superseded or cancelled
   * request rejects with a `cancelled` failure the caller can safely ignore.
   */
  run(
    request: ImportLayoutRequest,
    onProgress?: (progress: JobProgress) => void,
  ): RunHandle {
    const requestId = (this.#seq += 1);
    this.#settleActive(supersededError());

    const limits = resolveJobLimits({ ...this.#limits, ...request.limits });
    const fullRequest: ImportLayoutRequest = { ...request, limits };

    let resolve!: (result: ImportLayoutResult) => void;
    let reject!: (error: JobFailure) => void;
    const promise = new Promise<ImportLayoutResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const timer = setTimeout(() => {
      this.#fail(requestId, TIMEOUT_ERROR);
    }, limits.timeoutMs);

    const worker = this.#createWorker ? this.#tryCreateWorker() : null;

    if (worker) {
      const cleanup = () => {
        clearTimeout(timer);
        worker.terminate();
      };
      this.#active = { requestId, resolve, reject, settled: false, cleanup };

      worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
        this.#handleWorkerMessage(requestId, event.data, onProgress);
      };
      worker.onerror = (event) => {
        this.#fail(requestId, {
          code: "worker-error",
          message:
            (event as ErrorEvent).message || "The import worker crashed.",
        });
      };
      worker.onmessageerror = () => {
        this.#fail(requestId, {
          code: "worker-error",
          message: "The import worker sent an unreadable message.",
        });
      };

      worker.postMessage({ kind: "run", requestId, request: fullRequest });
    } else {
      const controller = new AbortController();
      const cleanup = () => {
        clearTimeout(timer);
        controller.abort();
      };
      this.#active = { requestId, resolve, reject, settled: false, cleanup };

      void this.#runInline(fullRequest, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (this.#active?.requestId === requestId) onProgress?.(progress);
        },
      }).then(
        (result) => this.#succeed(requestId, result),
        (error: unknown) => this.#failFromError(requestId, error),
      );
    }

    return {
      requestId,
      promise,
      cancel: () => this.#cancel(requestId),
    };
  }

  /** Cancels any in-flight request and releases the worker. Safe to call repeatedly. */
  dispose(): void {
    this.#settleActive(cancelledError());
  }

  #tryCreateWorker(): Worker | null {
    try {
      return this.#createWorker!();
    } catch {
      return null;
    }
  }

  #handleWorkerMessage(
    requestId: number,
    message: WorkerOutboundMessage,
    onProgress?: (progress: JobProgress) => void,
  ): void {
    // Defensive stale-result suppression: ignore anything not for the current request.
    if (message.requestId !== requestId) return;
    if (this.#active?.requestId !== requestId) return;

    switch (message.kind) {
      case "progress":
        onProgress?.(message.progress);
        break;
      case "result":
        this.#succeed(requestId, message.result);
        break;
      case "error":
        this.#fail(requestId, message.error);
        break;
    }
  }

  #succeed(requestId: number, result: ImportLayoutResult): void {
    const active = this.#active;
    if (!active || active.requestId !== requestId || active.settled) return;
    active.settled = true;
    active.cleanup();
    this.#active = null;
    active.resolve(result);
  }

  #fail(requestId: number, error: JobError): void {
    const active = this.#active;
    if (!active || active.requestId !== requestId || active.settled) return;
    active.settled = true;
    active.cleanup();
    this.#active = null;
    active.reject(new JobFailure(error));
  }

  #failFromError(requestId: number, error: unknown): void {
    if (error instanceof JobFailure) {
      this.#fail(requestId, error.error);
      return;
    }
    this.#fail(requestId, {
      code: "worker-error",
      message: error instanceof Error ? error.message : "The import failed.",
    });
  }

  #cancel(requestId: number): void {
    const active = this.#active;
    if (!active || active.requestId !== requestId || active.settled) return;
    this.#fail(requestId, cancelledError());
  }

  #settleActive(error: JobError): void {
    const active = this.#active;
    if (!active || active.settled) return;
    this.#fail(active.requestId, error);
  }
}
