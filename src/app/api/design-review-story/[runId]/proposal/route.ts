import { getRun } from "workflow/api";

import type { StoryProposal } from "@/workflows/design-review-story/contract";
import { PROPOSAL_NAMESPACE } from "@/workflows/design-review-story/steps";

interface RouteContext {
  readonly params: Promise<{ readonly runId: string }>;
}

/**
 * Returns the proposal a suspended run is waiting for a decision on.
 *
 * The proposal is published to its own stream at the approval gate so a reviewer can read the
 * scenes *before* deciding — seeing them is not applying them. Only the first chunk is read:
 * the stream carries exactly one proposal, and reading it from the durable replay resolves as
 * soon as it exists rather than waiting for the run to settle. A run that has not reached the
 * gate yet has nothing to return, which is a `425 Too Early`, not an error.
 */
export async function GET(
  _request: Request,
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

  const reader = run
    .getReadable<StoryProposal>({
      namespace: PROPOSAL_NAMESPACE,
      startIndex: 0,
    })
    .getReader();
  try {
    const { value, done } = await reader.read();
    if (done || value === undefined) {
      return Response.json(
        { error: `Run "${runId}" has not produced a proposal yet.` },
        { status: 425 },
      );
    }
    return Response.json({ runId, proposal: value });
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
