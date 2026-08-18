import { createHash } from "node:crypto";

import { entityId, snapshotId } from "@/domain/graph";
import {
  createStory,
  sceneId,
  storyDurationMs,
  storyId,
  validateStory,
  type Action,
  type Scene,
  type Story,
} from "@/domain/story";

import type {
  Critique,
  NarrativeAnalysis,
  SceneDraft,
  StoryProposal,
  ValidatedAgentContext,
} from "./contract";

/**
 * Stable stringification for content addressing: object keys are emitted in sorted order, so
 * two structurally equal values always hash to the same digest regardless of the key order
 * the model or the event log happened to produce.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export type ProposalRejectionCode =
  | "no-scenes"
  | "unknown-entity-reference"
  | "story-schema-invalid";

/** A draft the workflow refuses to propose, with the reason stated in domain terms. */
export class InvalidStoryDraftError extends Error {
  readonly code: ProposalRejectionCode;
  readonly details: readonly string[];

  constructor(code: ProposalRejectionCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "InvalidStoryDraftError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Turns model-authored scene drafts into a {@link Story} at the current schema version.
 *
 * Scene ids come from each scene's ordinal position, not from a generator, which is what
 * makes the result deterministic: the same drafts always produce the same ids, so a replayed
 * step or a re-run of the whole workflow yields an identical payload.
 */
export function assembleStory(
  title: string,
  context: ValidatedAgentContext,
  drafts: readonly SceneDraft[],
): Story {
  const scenes: readonly Scene[] = drafts.map((draft, index) => ({
    id: sceneId(`scene-${index + 1}`),
    title: draft.title,
    durationMs: draft.durationMs,
    actions: draft.actions.map((action): Action => {
      switch (action.type) {
        case "reveal":
        case "hide":
          return { type: action.type, target: entityId(action.target) };
        case "highlight":
          return {
            type: "highlight",
            target: entityId(action.target),
            ...(action.style !== undefined ? { style: action.style } : {}),
          };
        case "annotate":
          return { type: "annotate", target: entityId(action.target), text: action.text };
        case "camera":
          return { type: "camera", focus: action.focus.map(entityId) };
      }
    }),
  }));

  // The story id is content-addressed over everything that defines it, so two runs that
  // produce the same scenes converge on the same identity instead of forking the project.
  const identity = digest({
    title,
    snapshotId: context.graph.snapshotId,
    scenes,
  });

  return createStory({
    id: storyId(`story_${identity.slice(0, 32)}`),
    title,
    snapshotId: snapshotId(context.graph.snapshotId),
    scenes,
  });
}

/**
 * Assembles and validates a proposal, or throws {@link InvalidStoryDraftError}.
 *
 * The generated story is checked with the project's own {@link validateStory} against the
 * graph view in the context package — the same rules the project document is validated with
 * on import — so a proposal that reaches a caller is already known to be applicable. That
 * check is the reason scene generation is worth retrying: a draft referencing an entity the
 * model invented fails here, and the next attempt gets another chance.
 */
export function buildStoryProposal(input: {
  readonly title: string;
  readonly context: ValidatedAgentContext;
  readonly drafts: readonly SceneDraft[];
  readonly analysis: NarrativeAnalysis;
  readonly critique: Critique;
}): StoryProposal {
  const { title, context, drafts, analysis, critique } = input;

  if (drafts.length === 0) {
    throw new InvalidStoryDraftError("no-scenes", "The agent returned no scenes.");
  }

  const story = assembleStory(title, context, drafts);

  const errors = validateStory(story, {
    id: snapshotId(context.graph.snapshotId),
    entities: context.graph.entities.map((entity) => ({ id: entityId(entity.id) })),
  });

  if (errors.length > 0) {
    const missingEntity = errors.some((error) => error.code === "action-missing-entity");
    throw new InvalidStoryDraftError(
      missingEntity ? "unknown-entity-reference" : "story-schema-invalid",
      `The generated story failed ${errors.length} schema check(s): ${errors[0].message}`,
      errors.map((error) => error.message),
    );
  }

  const proposal = {
    story,
    totalDurationMs: storyDurationMs(story),
    analysis,
    critique,
  } satisfies Omit<StoryProposal, "proposalId">;

  return { proposalId: `prop_${digest(proposal).slice(0, 32)}`, ...proposal };
}
