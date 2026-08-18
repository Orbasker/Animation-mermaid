import { z } from "zod";

// Imported from the leaf modules rather than `@/domain`: the barrel also re-exports the
// Mermaid layout engine, and this module is bundled into the workflow sandbox, which cannot
// load it.
import {
  isSupportedSchemaVersion,
  type SchemaVersion,
} from "@/domain/schema-version";
import type { Story } from "@/domain/story";

/**
 * Runtime schemas for everything that crosses the `generateDesignReviewStory` boundary.
 *
 * A workflow argument, a step result, and a hook payload are each serialized, written to the
 * event log, and read back by a *different* process — possibly a different deployment. The
 * TypeScript types in `@/domain` describe those shapes but cannot enforce them across that
 * gap, so every value entering the workflow is parsed here first. Anything that fails to
 * parse is a caller mistake, not a transient fault, and the workflow fails it without
 * retrying.
 */

const schemaVersionSchema = z.custom<SchemaVersion>(
  isSupportedSchemaVersion,
  "unsupported schema version",
);

const entityIdSchema = z.string().min(1);

// Every member is `strict()`: the semantic-only guarantee is only worth anything if an extra
// key — a layout coordinate, a React Flow handle — is a validation failure rather than a
// silent passenger.
const agentEntitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("node"),
      id: entityIdSchema,
      label: z.string(),
      groupId: entityIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edge"),
      id: entityIdSchema,
      source: entityIdSchema,
      target: entityIdSchema,
      label: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("group"),
      id: entityIdSchema,
      label: z.string(),
      memberIds: z.array(entityIdSchema).readonly(),
    })
    .strict(),
]);

const graphEntitySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("node"),
      id: entityIdSchema,
      label: z.string(),
      groupId: entityIdSchema.optional(),
      attributes: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("edge"),
      id: entityIdSchema,
      source: entityIdSchema,
      target: entityIdSchema,
      label: z.string().optional(),
      attributes: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("group"),
      id: entityIdSchema,
      label: z.string(),
      memberIds: z.array(entityIdSchema).readonly(),
    })
    .strict(),
]);

const entityChangeSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("added"), entityId: entityIdSchema, after: graphEntitySchema })
    .strict(),
  z
    .object({ op: z.literal("removed"), entityId: entityIdSchema, before: graphEntitySchema })
    .strict(),
  z
    .object({
      op: z.literal("modified"),
      entityId: entityIdSchema,
      before: graphEntitySchema,
      after: graphEntitySchema,
    })
    .strict(),
]);

/**
 * The serializable context package the workflow is allowed to read. It mirrors
 * {@link import("@/domain").AgentContextPackage} exactly — semantic entities and an optional
 * diff, never layout coordinates or renderer handles — and `strict()` makes that a checked
 * guarantee rather than a convention: an extra key (a stray `layout`, a React Flow node)
 * fails validation instead of quietly reaching the model.
 */
export const agentContextPackageSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    intent: z.string().min(1, "intent must describe what the workflow should do"),
    graph: z
      .object({
        snapshotId: z.string().min(1),
        diagramType: z.string().min(1),
        entities: z
          .array(agentEntitySchema)
          .min(1, "graph must contain at least one entity")
          .readonly(),
      })
      .strict(),
    comparison: z
      .object({
        baseSnapshotId: z.string().min(1),
        targetSnapshotId: z.string().min(1),
        changes: z.array(entityChangeSchema).readonly(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => {
      const ids = new Set(value.graph.entities.map((entity) => entity.id));
      return ids.size === value.graph.entities.length;
    },
    { message: "graph entity ids must be unique", path: ["graph", "entities"] },
  );

export type ValidatedAgentContext = z.infer<typeof agentContextPackageSchema>;

/** Caller-supplied request that starts a run. */
export const storyRequestSchema = z
  .object({
    /** Human-readable title for the proposed story. */
    title: z.string().min(1).max(200),
    context: agentContextPackageSchema,
    /**
     * Target number of scenes. The model is asked for this many; the critique step may
     * report that fewer are warranted, but the schema bounds keep a runaway story out.
     */
    sceneCount: z.number().int().min(1).max(24).default(6),
  })
  .strict();

/**
 * The workflow's public input type.
 *
 * Wider than the domain's `AgentContextPackage` on purpose: ids are plain strings, because
 * a request arriving as JSON has no branded types, while a caller holding the value
 * `buildAgentContextPackage()` returned satisfies it directly. The context arrays are declared
 * `readonly` in the schema so the domain's readonly shape is assignable here without a cast.
 */
export type StoryRequest = z.input<typeof storyRequestSchema>;

export type ValidatedStoryRequest = z.infer<typeof storyRequestSchema>;

/**
 * The narrative arc the agent proposes before any scene exists. Keeping analysis a separate,
 * separately-retryable step means a transient failure while drafting scenes never re-runs the
 * (more expensive, more variable) reasoning about what the story should say.
 */
export const narrativeAnalysisSchema = z
  .object({
    thesis: z.string().min(1),
    audience: z.string().min(1),
    beats: z
      .array(
        z.object({
          summary: z.string().min(1),
          entityIds: z.array(entityIdSchema),
        }),
      )
      .min(1),
  })
  .strict();

export type NarrativeAnalysis = z.infer<typeof narrativeAnalysisSchema>;

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reveal"), target: entityIdSchema }).strict(),
  z.object({ type: z.literal("hide"), target: entityIdSchema }).strict(),
  z
    .object({
      type: z.literal("highlight"),
      target: entityIdSchema,
      style: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("annotate"), target: entityIdSchema, text: z.string().min(1) })
    .strict(),
  z.object({ type: z.literal("camera"), focus: z.array(entityIdSchema) }).strict(),
]);

/**
 * A scene as the model returns it: no id. Scene ids are assigned by the workflow from the
 * scene's ordinal position, so the same model output always yields the same identifiers —
 * see {@link import("./proposal").buildStoryProposal}.
 */
const sceneDraftSchema = z
  .object({
    title: z.string().min(1),
    durationMs: z.number().int().min(0).max(120_000),
    actions: z.array(actionSchema).min(1),
  })
  .strict();

export const storyDraftSchema = z
  .object({ scenes: z.array(sceneDraftSchema).min(1) })
  .strict();

export type StoryDraft = z.infer<typeof storyDraftSchema>;
export type SceneDraft = z.infer<typeof sceneDraftSchema>;

/** The agent's own review of the draft, surfaced to the human alongside the proposal. */
export const critiqueSchema = z
  .object({
    verdict: z.enum(["ready", "ready_with_notes", "needs_rework"]),
    summary: z.string().min(1),
    notes: z
      .array(
        z.object({
          sceneTitle: z.string().min(1).optional(),
          note: z.string().min(1),
        }),
      )
      .default([]),
  })
  .strict();

export type Critique = z.infer<typeof critiqueSchema>;

/** Named phases a run moves through, in order. Progress events carry one of these. */
export const STORY_PHASES = [
  "validating-context",
  "analyzing-narrative",
  "generating-scenes",
  "critiquing",
  "awaiting-approval",
  "settled",
] as const;

export type StoryPhase = (typeof STORY_PHASES)[number];

/**
 * A progress event. These go to the `progress` stream namespace, never the default one, so a
 * client can replay the (small, bounded) list of final results without first replaying every
 * intermediate note — and so a reconnecting client can subscribe to one without the other.
 */
export const progressEventSchema = z
  .object({
    phase: z.enum(STORY_PHASES),
    /** Short human-readable note; safe to render directly. */
    message: z.string(),
    /** Attempt number for retried phases, 1-based. */
    attempt: z.number().int().min(1).optional(),
  })
  .strict();

export type ProgressEvent = z.infer<typeof progressEventSchema>;

/** The human decision the workflow pauses for. */
export const storyDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /** Optional reviewer note, echoed back in the outcome. */
    note: z.string().max(2_000).optional(),
    reviewer: z.string().min(1).max(200).optional(),
  })
  .strict();

export type StoryDecision = z.infer<typeof storyDecisionSchema>;

/**
 * The proposal payload an approved run returns. It is a pure function of the validated
 * context, the model output, and the decision — no timestamps, no random ids — so replaying
 * the run reproduces it exactly and a client can compare two runs for equality.
 *
 * `story` is the domain's own {@link Story}, at {@link CURRENT_SCHEMA_VERSION} and already
 * validated against the context graph, so an approved proposal drops straight into a
 * `ProjectDocument` without reshaping.
 */
export interface StoryProposal {
  /** Content-addressed id, derived from the story below. */
  readonly proposalId: string;
  readonly story: Story;
  readonly totalDurationMs: number;
  readonly analysis: NarrativeAnalysis;
  readonly critique: Critique;
}

/** The terminal value of a run. `status` discriminates what, if anything, may be applied. */
export type StoryOutcome =
  | {
      readonly status: "approved";
      readonly proposal: StoryProposal;
      readonly reviewer?: string;
      readonly note?: string;
      /** The eve session that produced the narrative, for cross-referencing Agent Runs. */
      readonly agentSessionId?: string;
    }
  | {
      readonly status: "rejected";
      readonly reviewer?: string;
      readonly note?: string;
      readonly agentSessionId?: string;
    };
