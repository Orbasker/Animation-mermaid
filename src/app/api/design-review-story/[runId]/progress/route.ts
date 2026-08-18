import { getRun } from "workflow/api";

import type { ProgressEvent } from "@/workflows/design-review-story/contract";
import { PROGRESS_NAMESPACE } from "@/workflows/design-review-story/steps";

interface RouteContext {
  readonly params: Promise<{ readonly runId: string }>;
}

/**
 * Encodes the run's stream for the wire.
 *
 * `getReadable()` yields deserialized JavaScript values — the objects the workflow wrote, not
 * bytes — so an HTTP body needs them re-encoded. One JSON object per line lets a client parse
 * events as they arrive instead of waiting for the stream to finish.
 */
function toNdjson(
  source: ReadableStream<ProgressEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return source.pipeThrough(
    new TransformStream<ProgressEvent, Uint8Array>({
      transform(event, controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      },
    }),
  );
}

/**
 * Reconnects to a run's named progress stream.
 *
 * Progress lives in its own namespace, so this replays only the phase notes — never the
 * settled outcome. `startIndex` lets a client resume from the last chunk it saw instead of
 * replaying the run from the beginning; negative values count back from the end, which is why
 * the tail index is returned in a header (the client needs it to turn a relative position into
 * an absolute one on a later retry).
 *
 * This route is listed under `functions` in `vercel.json` with `supportsCancellation`: a route
 * that pipes a live stream keeps the invocation running — and billing — to the function's max
 * duration after a client disconnects unless Vercel is told to forward the abort.
 */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { runId } = await context.params;
  const run = getRun(runId);

  if (!(await run.exists)) {
    return Response.json(
      { error: `No run with id "${runId}".` },
      { status: 404 },
    );
  }

  const raw = new URL(request.url).searchParams.get("startIndex");
  const startIndex = raw === null ? undefined : Number.parseInt(raw, 10);
  if (startIndex !== undefined && Number.isNaN(startIndex)) {
    return Response.json(
      { error: "startIndex must be an integer." },
      { status: 400 },
    );
  }

  const readable = run.getReadable<ProgressEvent>({
    namespace: PROGRESS_NAMESPACE,
    ...(startIndex !== undefined ? { startIndex } : {}),
  });
  const tailIndex = await readable.getTailIndex();

  return new Response(toNdjson(readable), {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-workflow-run-id": runId,
      "x-workflow-stream-tail-index": String(tailIndex),
    },
  });
}
