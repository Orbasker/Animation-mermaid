/// <reference lib="webworker" />
// Must run before anything pulls in ELK: it steers the layout engine to its in-process mode.
import "@/domain/mermaid/worker/elk-runtime-shim";
import { JobFailure, runImportLayoutJob } from "@/domain/mermaid/worker/job";
import type {
  JobError,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from "@/domain/mermaid/worker/protocol";

/**
 * The dedicated Web Worker entry point. It owns no state beyond the message it is handling:
 * each `run` message is parsed and laid out off the UI thread, with progress, the final
 * result, or a structured error posted back tagged with the originating `requestId`.
 *
 * Cancellation is deliberately not handled here — the main-thread controller terminates the
 * worker to abandon a job, which is the only way to reclaim the CPU from an uninterruptible
 * ELK layout. A terminated worker simply stops posting.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerOutboundMessage): void {
  ctx.postMessage(message);
}

ctx.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;
  if (message.kind !== "run") return;
  const { requestId, request } = message;

  try {
    const result = await runImportLayoutJob(request, {
      onProgress: (progress) => post({ kind: "progress", requestId, progress }),
    });
    post({ kind: "result", requestId, result });
  } catch (error) {
    const jobError: JobError =
      error instanceof JobFailure
        ? error.error
        : {
            code: "worker-error",
            message: error instanceof Error ? error.message : "Worker failed.",
          };
    post({ kind: "error", requestId, error: jobError });
  }
};
