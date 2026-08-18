import { getRun } from "workflow/api";
import { WorkflowRunFailedError } from "workflow/internal/errors";

import type { StoryOutcome } from "@/workflows/design-review-story/contract";

interface RouteContext {
  readonly params: Promise<{ readonly runId: string }>;
}

/**
 * Reads the failure reason a `failed` run recorded.
 *
 * A failed run has no return value to await — polling it throws — so the message the workflow
 * failed with is only reachable by catching that throw. Surfacing it here is what lets a client
 * tell a Gateway budget cap from a rate limit from a provider fault and explain the right next
 * action, rather than showing an opaque "the run failed".
 */
async function failureMessage(run: {
  readonly returnValue: Promise<unknown>;
}): Promise<string> {
  try {
    await run.returnValue;
    return "The run failed.";
  } catch (error) {
    if (WorkflowRunFailedError.is(error)) {
      return error.cause.message;
    }
    return error instanceof Error ? error.message : "The run failed.";
  }
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
  if (status === "failed") {
    return Response.json({ runId, status, error: await failureMessage(run) });
  }
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
