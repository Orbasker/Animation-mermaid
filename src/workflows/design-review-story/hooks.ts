import { defineHook } from "workflow";

import { storyDecisionSchema } from "./contract";

/**
 * The human approval gate.
 *
 * Defined in its own module because both sides need it: the workflow creates the hook and
 * suspends on it, and the API route resumes it. Sharing one definition is what makes the
 * payload type and the runtime validation agree across that boundary — a decision posted by a
 * client is checked against the same schema the workflow will read.
 */
export const storyDecisionHook = defineHook({ schema: storyDecisionSchema });

/**
 * The hook token for a run. Derived from the workflow run id so a client that has the run id
 * — the same id it uses to reconnect to the stream — can submit the decision without the
 * workflow having to hand out a second identifier.
 */
export function decisionToken(runId: string): string {
  return `design-review-story:decision:${runId}`;
}
