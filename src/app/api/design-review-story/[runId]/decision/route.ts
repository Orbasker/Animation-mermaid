import { getRun } from "workflow/api";
import { HookNotFoundError } from "workflow/internal/errors";

import { storyDecisionSchema } from "@/workflows/design-review-story/contract";
import {
  decisionToken,
  storyDecisionHook,
} from "@/workflows/design-review-story/hooks";

interface RouteContext {
  readonly params: Promise<{ readonly runId: string }>;
}

/**
 * Submits the human decision a paused run is waiting on.
 *
 * The run has been suspended — consuming nothing — since it reached the approval gate, possibly
 * across a deploy or days of inactivity. Resuming it by token is what turns "the reviewer
 * clicked approve" into the run continuing exactly where it left off.
 */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { runId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = storyDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid decision.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  if (!(await getRun(runId).exists)) {
    return Response.json(
      { error: `No run with id "${runId}".` },
      { status: 404 },
    );
  }

  // A run that already settled — or that has not reached the gate yet — has no live hook for
  // this token. That is a conflict with the run's state, not a bad request or a missing run,
  // and it is what makes the decision endpoint safe to retry: a second approval cannot land.
  try {
    const resumed = await storyDecisionHook.resume(
      decisionToken(runId),
      parsed.data,
    );
    if (!resumed) {
      return Response.json(
        { error: `Run "${runId}" is not waiting for a decision.` },
        { status: 409 },
      );
    }
  } catch (error) {
    if (HookNotFoundError.is(error)) {
      return Response.json(
        { error: `Run "${runId}" is not waiting for a decision.` },
        { status: 409 },
      );
    }
    throw error;
  }

  return Response.json({ runId, decision: parsed.data.decision });
}
