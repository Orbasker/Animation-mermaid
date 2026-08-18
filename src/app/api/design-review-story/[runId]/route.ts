import { getRun } from "workflow/api";

import type { StoryOutcome } from "@/workflows/design-review-story/contract";

interface RouteContext {
  readonly params: Promise<{ readonly runId: string }>;
}

/**
 * Reports where a run stands, and its outcome once it has one.
 *
 * This is the endpoint a client hits on load with a stored run id: it answers "is that run
 * still there, and did it settle?" without consuming the stream, so reconnecting is cheap and
 * repeatable.
 */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { runId } = await context.params;
  const run = getRun<StoryOutcome>(runId);

  if (!(await run.exists)) {
    return Response.json({ error: `No run with id "${runId}".` }, { status: 404 });
  }

  const status = await run.status;
  if (status !== "completed") {
    return Response.json({ runId, status });
  }

  return Response.json({ runId, status, outcome: await run.returnValue });
}

/**
 * Cancels a run.
 *
 * Distinct from rejecting a proposal: cancelling abandons the run before it settles and leaves
 * no outcome at all, whereas rejecting is a decision the run records and returns. Neither
 * touches a stored project.
 */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const { runId } = await context.params;
  const run = getRun(runId);

  if (!(await run.exists)) {
    return Response.json({ error: `No run with id "${runId}".` }, { status: 404 });
  }

  await run.cancel();
  return Response.json({ runId, status: "cancelled" });
}
