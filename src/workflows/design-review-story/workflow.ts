import { getWorkflowMetadata } from "workflow";

import { storyRequestSchema, type StoryOutcome, type StoryRequest } from "./contract";
import { decisionToken, storyDecisionHook } from "./hooks";
import {
  analyzeNarrativeStep,
  buildProposalStep,
  closeStreams,
  critiqueDraftStep,
  draftScenesStep,
  emitProgress,
  emitProposal,
  emitResult,
  validateContext,
} from "./steps";

/**
 * Proposes a design-review animation for a diagram, pausing for human approval before the
 * proposal is returned.
 *
 * The whole function body is a replayable description of order. It holds no model client, no
 * database handle, and no timer: each `await` on a step is a suspension point recorded in the
 * run's event log, so a run survives the process that started it. That is what "reconnect
 * after a reload" means here — the client is not holding the run open, the log is, and a
 * client rejoins by run id.
 *
 * The bounded shape is deliberate. eve decides what the agent says; this function decides only
 * how many bounded questions are asked, in what order, how many times a failed one is retried,
 * and that nothing is returned as applicable until a human approves it.
 */
export async function generateDesignReviewStory(
  request: StoryRequest,
): Promise<StoryOutcome> {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();

  await emitProgress({
    phase: "validating-context",
    message: "Checking the context package.",
  });

  // Parsed inside a step so a malformed request fails as a recorded, inspectable step failure
  // rather than as an error thrown while the workflow is being replayed.
  const context = await validateContext(request);
  const parsedRequest = storyRequestSchema.parse(request);

  await emitProgress({
    phase: "analyzing-narrative",
    message: "Asking the agent for the narrative arc.",
  });
  const analysis = await analyzeNarrativeStep({
    title: parsedRequest.title,
    context,
  });

  await emitProgress({
    phase: "generating-scenes",
    message: `Drafting about ${parsedRequest.sceneCount} scenes.`,
  });
  const draft = await draftScenesStep({
    context,
    analysis: analysis.data,
    sceneCount: parsedRequest.sceneCount,
    sessionId: analysis.sessionId,
  });

  await emitProgress({
    phase: "critiquing",
    message: "Asking the agent to review its own draft.",
  });
  const critique = await critiqueDraftStep({
    draft: draft.data,
    analysis: analysis.data,
    sessionId: analysis.sessionId,
  });

  const proposal = await buildProposalStep({
    title: parsedRequest.title,
    context,
    draft: draft.data,
    analysis: analysis.data,
    critique: critique.data,
  });

  // The hook is created before the progress note so the token is registered by the time a
  // client reads "awaiting-approval" and posts a decision.
  using hook = storyDecisionHook.create({ token: decisionToken(workflowRunId) });

  // Publish the proposal before announcing the gate, so a client that reacts to
  // "awaiting-approval" by fetching the proposal always finds it already written.
  await emitProposal(proposal);

  await emitProgress({
    phase: "awaiting-approval",
    message: `Waiting for a decision on proposal ${proposal.proposalId}.`,
  });

  const decision = await hook;

  // Rejection is a normal, successful outcome that carries no proposal. Nothing in this
  // workflow writes to a project — persistence is local-first and client-owned — so declining
  // leaves nothing to undo, and the payload gives a client nothing it could apply by mistake.
  const outcome: StoryOutcome =
    decision.decision === "approve"
      ? {
          status: "approved",
          proposal,
          agentSessionId: analysis.sessionId,
          ...(decision.reviewer !== undefined ? { reviewer: decision.reviewer } : {}),
          ...(decision.note !== undefined ? { note: decision.note } : {}),
        }
      : {
          status: "rejected",
          agentSessionId: analysis.sessionId,
          ...(decision.reviewer !== undefined ? { reviewer: decision.reviewer } : {}),
          ...(decision.note !== undefined ? { note: decision.note } : {}),
        };

  await emitProgress({
    phase: "settled",
    message: `The reviewer chose to ${decision.decision}.`,
  });
  await emitResult(outcome);
  await closeStreams();

  return outcome;
}
