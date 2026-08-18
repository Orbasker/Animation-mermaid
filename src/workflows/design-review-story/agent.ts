import { FatalError, RetryableError } from "workflow";

import {
  critiqueSchema,
  narrativeAnalysisSchema,
  storyDraftSchema,
  type Critique,
  type NarrativeAnalysis,
  type StoryDraft,
  type ValidatedAgentContext,
} from "./contract";
import { resolveAgentTransport, type AgentTurn } from "./transport";

/**
 * The workflow's view of the design-review agent.
 *
 * Every call here is one eve turn. eve owns the agent: the model, the instructions, the
 * skills, the tools, and the conversational state behind `sessionId`. This module owns only
 * the prompt for each bounded question and the translation of transport failures into the
 * Workflow DevKit's retry vocabulary — that split is what keeps orchestration (how many
 * attempts, in what order, with what human gate) out of the agent and agent behavior out of
 * the workflow.
 *
 * The eve session id is threaded through step results rather than held in a closure, because
 * a step boundary is a process boundary: only serializable values survive it.
 */

/** A turn's result, paired with the session it belongs to so later steps can continue it. */
export interface AgentReply<T> {
  readonly data: T;
  readonly sessionId: string;
}

function describeGraph(context: ValidatedAgentContext): string {
  const nodes = context.graph.entities.filter(
    (entity) => entity.kind === "node",
  );
  const edges = context.graph.entities.filter(
    (entity) => entity.kind === "edge",
  );
  const groups = context.graph.entities.filter(
    (entity) => entity.kind === "group",
  );

  const lines = [
    `Diagram type: ${context.graph.diagramType}`,
    `Snapshot: ${context.graph.snapshotId}`,
    "",
    "Nodes (id — label):",
    ...nodes.map((node) => `- ${node.id} — ${node.label}`),
  ];

  if (groups.length > 0) {
    lines.push("", "Groups (id — label — members):");
    for (const group of groups) {
      if (group.kind !== "group") continue;
      lines.push(
        `- ${group.id} — ${group.label} — ${group.memberIds.join(", ")}`,
      );
    }
  }

  if (edges.length > 0) {
    lines.push("", "Edges (id — source -> target — label):");
    for (const edge of edges) {
      if (edge.kind !== "edge") continue;
      lines.push(
        `- ${edge.id} — ${edge.source} -> ${edge.target}${edge.label ? ` — ${edge.label}` : ""}`,
      );
    }
  }

  if (context.comparison) {
    lines.push(
      "",
      `Comparison ${context.comparison.baseSnapshotId} -> ${context.comparison.targetSnapshotId}:`,
      ...context.comparison.changes.map(
        (change) => `- ${change.op} ${change.entityId}`,
      ),
    );
  }

  return lines.join("\n");
}

/**
 * Every entity id the agent is allowed to name. Repeated in each prompt because a scene that
 * references anything else is rejected by the schema check downstream — stating the closed set
 * makes a valid first attempt far more likely than letting the model infer it.
 */
function allowedIds(context: ValidatedAgentContext): string {
  return context.graph.entities.map((entity) => entity.id).join(", ");
}

async function turn<T>(
  input: AgentTurn,
  parse: (value: unknown) => T,
): Promise<AgentReply<T>> {
  const transport = resolveAgentTransport();
  const reply = await transport.turn(input);
  return { data: parse(reply.data), sessionId: reply.sessionId };
}

/**
 * Translates an agent-schema mismatch into a fatal failure.
 *
 * A response that does not match the requested schema is a *retryable* condition — the next
 * attempt may well satisfy it — but only up to the step's retry budget. Throwing
 * `RetryableError` here lets the DevKit spend that budget, and the step's `maxRetries` bounds
 * it, so a persistently misbehaving model ends the run instead of looping.
 */
function offSchema(phase: string, error: unknown): never {
  throw new RetryableError(
    `The agent's ${phase} response did not match the required schema: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

/** Opens the session and asks for the narrative arc. */
export async function analyzeNarrative(input: {
  readonly context: ValidatedAgentContext;
  readonly title: string;
  readonly attempt: number;
}): Promise<AgentReply<NarrativeAnalysis>> {
  const { context, title } = input;
  return turn(
    {
      sessionId: undefined,
      attempt: input.attempt,
      phase: "analyze",
      outputSchema: narrativeAnalysisSchema,
      prompt: [
        `You are proposing a design-review animation titled "${title}".`,
        `The reviewer's intent: ${context.intent}`,
        "",
        describeGraph(context),
        "",
        "Identify the narrative arc a reviewer needs to follow this design: the single claim the",
        "animation should make (thesis), who it is for (audience), and the ordered beats that get",
        "there. Each beat names the entity ids it concerns.",
        `Use only these entity ids: ${allowedIds(context)}.`,
      ].join("\n"),
    },
    (value) => {
      const parsed = narrativeAnalysisSchema.safeParse(value);
      if (!parsed.success) offSchema("narrative analysis", parsed.error);
      return parsed.data;
    },
  );
}

/** Continues the session and asks for the scenes themselves. */
export async function draftScenes(input: {
  readonly context: ValidatedAgentContext;
  readonly analysis: NarrativeAnalysis;
  readonly sceneCount: number;
  readonly sessionId: string;
  readonly attempt: number;
}): Promise<AgentReply<StoryDraft>> {
  const { context, analysis, sceneCount } = input;
  return turn(
    {
      sessionId: input.sessionId,
      attempt: input.attempt,
      phase: "scenes",
      outputSchema: storyDraftSchema,
      prompt: [
        `Turn that arc into about ${sceneCount} scenes.`,
        "",
        "Each scene is one beat of playback: a title, a duration in milliseconds, and the actions",
        "applied together for that duration. Available actions are reveal, hide, highlight,",
        "annotate (with caption text), and camera (framing a set of entities).",
        "",
        `Every id you name must be one of: ${allowedIds(context)}.`,
        "Naming anything else invalidates the whole story.",
        "",
        `Thesis to serve: ${analysis.thesis}`,
      ].join("\n"),
    },
    (value) => {
      const parsed = storyDraftSchema.safeParse(value);
      if (!parsed.success) offSchema("scene draft", parsed.error);
      return parsed.data;
    },
  );
}

/** Asks the agent to review its own draft before a human sees it. */
export async function critiqueDraft(input: {
  readonly draft: StoryDraft;
  readonly analysis: NarrativeAnalysis;
  readonly sessionId: string;
  readonly attempt: number;
}): Promise<AgentReply<Critique>> {
  return turn(
    {
      sessionId: input.sessionId,
      attempt: input.attempt,
      phase: "critique",
      outputSchema: critiqueSchema,
      prompt: [
        "Review the scenes you just produced against the thesis and audience you named.",
        "Load the design-review checklist skill if it helps.",
        "Report whether they are ready to show a reviewer, and note anything a human should",
        "decide before applying them.",
      ].join("\n"),
    },
    (value) => {
      const parsed = critiqueSchema.safeParse(value);
      if (!parsed.success) offSchema("critique", parsed.error);
      return parsed.data;
    },
  );
}

/**
 * Classifies a transport failure for the DevKit. Anything the next attempt could plausibly
 * survive — a timeout, a rate limit, an upstream 5xx — retries; a request the agent will
 * reject identically every time does not.
 */
export function classifyAgentError(error: unknown): never {
  if (error instanceof RetryableError || error instanceof FatalError) {
    throw error;
  }

  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") {
    if (status === 429) {
      throw new RetryableError("The agent is rate limited.", {
        retryAfter: "30s",
      });
    }
    if (status >= 500) {
      throw new RetryableError(`The agent returned ${status}.`);
    }
    if (status === 408) {
      throw new RetryableError("The agent request timed out.");
    }
    if (status >= 400) {
      throw new FatalError(
        `The agent rejected the request with ${status}; retrying cannot help: ${
          (error as { body?: string }).body ?? ""
        }`.trim(),
      );
    }
  }

  // Network-level faults (DNS, connection reset, abort) surface as plain TypeErrors from
  // fetch and are exactly the case durable retries exist for.
  throw new RetryableError(
    `The agent call failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}
