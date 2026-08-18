import { FatalError, getStepMetadata, getWritable } from "workflow";

import {
  agentContextPackageSchema,
  type Critique,
  type NarrativeAnalysis,
  type ProgressEvent,
  type StoryDraft,
  type StoryProposal,
  type ValidatedAgentContext,
} from "./contract";
import {
  analyzeNarrative,
  classifyAgentError,
  critiqueDraft,
  draftScenes,
  type AgentReply,
} from "./agent";
import { buildStoryProposal, InvalidStoryDraftError } from "./proposal";

/**
 * The step layer. Everything with side effects or Node dependencies lives here, so the
 * workflow function itself stays a bounded, replayable description of *order* — which is what
 * lets the DevKit resume a run from its event log after the process that started it is gone.
 *
 * Each step is separately retried and separately cached: once a step's result is recorded, a
 * later failure never re-runs it. That is what makes "retry the model call" safe — a retried
 * scene draft does not redo the narrative analysis that preceded it.
 */

/** Progress notes go to their own namespace, kept out of the default result stream. */
export const PROGRESS_NAMESPACE = "progress";

async function writeProgress(event: ProgressEvent): Promise<void> {
  const writer = getWritable<ProgressEvent>({
    namespace: PROGRESS_NAMESPACE,
  }).getWriter();
  try {
    await writer.write(event);
  } finally {
    writer.releaseLock();
  }
}

/**
 * Announces a phase transition. Called from the workflow, so it is a step of its own and is
 * replayed from the event log rather than re-executed: each phase is announced exactly once,
 * however many times the work inside it is attempted.
 */
export async function emitProgress(event: ProgressEvent): Promise<void> {
  "use step";
  await writeProgress(event);
}

/**
 * Announces one attempt at a phase, from inside the step making it.
 *
 * Unlike {@link emitProgress} this is not its own step, so it is not deduplicated by replay —
 * a retried step writes another note. That is the point: a client watching the progress stream
 * sees "attempt 2" appear, and the notes together record how many times each phase actually
 * ran.
 */
async function noteAttempt(phase: ProgressEvent["phase"], attempt: number): Promise<void> {
  await writeProgress({
    phase,
    attempt,
    message: attempt === 1 ? "Calling the agent." : `Retrying the agent (attempt ${attempt}).`,
  });
}

/** Closes both streams so a reconnecting client sees a terminated stream, not a hang. */
export async function closeStreams(): Promise<void> {
  "use step";
  await getWritable({ namespace: PROGRESS_NAMESPACE }).close();
  await getWritable().close();
}

/**
 * Validates the context package before a single token is spent on it.
 *
 * An invalid package is a caller bug, so this throws `FatalError`: retrying the same malformed
 * input can only fail the same way, and burning the retry budget on it would delay the error
 * the caller needs to see.
 */
export async function validateContext(
  request: unknown,
): Promise<ValidatedAgentContext> {
  "use step";
  const parsed = agentContextPackageSchema.safeParse(
    (request as { context?: unknown })?.context,
  );
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new FatalError(`The agent context package is not valid: ${issues}`);
  }
  return parsed.data;
}

async function withAgentErrors<T>(
  phase: ProgressEvent["phase"],
  call: (attempt: number) => Promise<AgentReply<T>>,
): Promise<AgentReply<T>> {
  const attempt = getStepMetadata().attempt ?? 1;
  await noteAttempt(phase, attempt);
  try {
    return await call(attempt);
  } catch (error) {
    classifyAgentError(error);
  }
}

export async function analyzeNarrativeStep(input: {
  readonly title: string;
  readonly context: ValidatedAgentContext;
}): Promise<AgentReply<NarrativeAnalysis>> {
  "use step";
  return withAgentErrors("analyzing-narrative", (attempt) =>
    analyzeNarrative({ title: input.title, context: input.context, attempt }),
  );
}
analyzeNarrativeStep.maxRetries = 3;

export async function draftScenesStep(input: {
  readonly context: ValidatedAgentContext;
  readonly analysis: NarrativeAnalysis;
  readonly sceneCount: number;
  readonly sessionId: string;
}): Promise<AgentReply<StoryDraft>> {
  "use step";
  return withAgentErrors("generating-scenes", (attempt) =>
    draftScenes({ ...input, attempt }),
  );
}
draftScenesStep.maxRetries = 3;

export async function critiqueDraftStep(input: {
  readonly draft: StoryDraft;
  readonly analysis: NarrativeAnalysis;
  readonly sessionId: string;
}): Promise<AgentReply<Critique>> {
  "use step";
  return withAgentErrors("critiquing", (attempt) => critiqueDraft({ ...input, attempt }));
}
critiqueDraftStep.maxRetries = 3;

/**
 * Assembles the proposal and validates the generated scenes against the project schema.
 *
 * A draft that fails validation is fatal *here* on purpose: the retry that could fix it is a
 * new scene draft, which is `draftScenesStep`'s budget to spend, not this step's. Re-running
 * pure assembly over the same rejected draft would just fail identically.
 */
export async function buildProposalStep(input: {
  readonly title: string;
  readonly context: ValidatedAgentContext;
  readonly draft: StoryDraft;
  readonly analysis: NarrativeAnalysis;
  readonly critique: Critique;
}): Promise<StoryProposal> {
  "use step";
  try {
    return buildStoryProposal({
      title: input.title,
      context: input.context,
      drafts: input.draft.scenes,
      analysis: input.analysis,
      critique: input.critique,
    });
  } catch (error) {
    if (error instanceof InvalidStoryDraftError) {
      throw new FatalError(`${error.message} (${error.code})`);
    }
    throw error;
  }
}
buildProposalStep.maxRetries = 0;

/** Writes the settled outcome to the default stream, separate from progress notes. */
export async function emitResult(value: unknown): Promise<void> {
  "use step";
  const writer = getWritable().getWriter();
  try {
    await writer.write(value);
  } finally {
    writer.releaseLock();
  }
}
