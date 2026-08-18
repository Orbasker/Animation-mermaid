import { buildAgentContextPackage } from "@/domain/agent-context";
import { currentArchitectureSnapshot } from "@/domain/fixtures";
import { agentContextPackageSchema } from "@/workflows/design-review-story/contract";
import type {
  Critique,
  NarrativeAnalysis,
  ProgressEvent,
  SceneDraft,
  StoryOutcome,
  StoryProposal,
  StoryRequest,
} from "@/workflows/design-review-story/contract";
import { buildStoryProposal } from "@/workflows/design-review-story/proposal";

/**
 * The baseline design-review journey, materialized as plain data.
 *
 * This is the single fixture the whole verification suite shares: the Playwright browser
 * journey reads it from `e2e/fixtures/baseline.json` to drive the Web → API → Queue → Worker
 * → Database path with a cached-read proposal, and {@link src/test/e2e-fixture.test.ts} rebuilds
 * it here to prove the committed JSON has not drifted from what the domain would produce.
 *
 * It is built the same way the durable workflow builds a real one — through
 * {@link buildStoryProposal}, so the story ids and content-addressed proposal id are the domain's,
 * not invented — over the sample "current" architecture the editor loads by default. That is why
 * an approved run drops straight into the sample project with no reshaping.
 */

export const BASELINE_TITLE = "Request path baseline";

export const BASELINE_INTENT =
  "Walk a reviewer through how a request reaches the database.";

const BASELINE_SCENE_COUNT = 4;

const BASELINE_DRAFTS: readonly SceneDraft[] = [
  {
    title: "A request arrives",
    durationMs: 1600,
    actions: [
      { type: "reveal", target: "client" },
      { type: "reveal", target: "api" },
      { type: "reveal", target: "client->api" },
      { type: "camera", focus: ["client", "api"] },
    ],
  },
  {
    title: "The backend takes over",
    durationMs: 1800,
    actions: [
      { type: "reveal", target: "service" },
      { type: "reveal", target: "api->service" },
      { type: "highlight", target: "service", style: "active" },
      {
        type: "annotate",
        target: "service",
        text: "Validates and processes the order",
      },
    ],
  },
  {
    title: "It reaches the database",
    durationMs: 1600,
    actions: [
      { type: "reveal", target: "db" },
      { type: "reveal", target: "service->db" },
      { type: "annotate", target: "db", text: "System of record" },
      { type: "camera", focus: ["service", "db"] },
    ],
  },
  {
    title: "The whole path at a glance",
    durationMs: 1400,
    actions: [{ type: "camera", focus: [] }],
  },
];

const BASELINE_ANALYSIS: NarrativeAnalysis = {
  thesis:
    "A single request travels from the client through the gateway and service before it is persisted.",
  audience: "Engineers new to the orders backend.",
  beats: [
    {
      summary: "The client calls the API gateway.",
      entityIds: ["client", "api"],
    },
    {
      summary: "The gateway hands off to the orders service.",
      entityIds: ["service"],
    },
    { summary: "The service persists to the database.", entityIds: ["db"] },
  ],
};

const BASELINE_CRITIQUE: Critique = {
  verdict: "ready_with_notes",
  summary:
    "The scenes track the request path cleanly; the final overview is brief.",
  notes: [
    {
      sceneTitle: "The whole path at a glance",
      note: "Consider holding the final frame a little longer.",
    },
  ],
};

/**
 * The progress a reconnecting client replays up to the approval gate. Deliberately stops at
 * `awaiting-approval`: `settled` is only written once a decision lands, and the mocked status
 * endpoint reports the terminal outcome instead.
 */
const BASELINE_PROGRESS: readonly ProgressEvent[] = [
  { phase: "validating-context", message: "Checking the context package." },
  { phase: "analyzing-narrative", message: "Analyzing the narrative arc." },
  { phase: "generating-scenes", message: "Drafting the scenes." },
  { phase: "critiquing", message: "Reviewing the draft against the thesis." },
  { phase: "awaiting-approval", message: "Waiting for your approval." },
];

export interface BaselineFixture {
  /** The request body the copilot POSTs to start the run. */
  readonly request: StoryRequest;
  /** The cached-read proposal the suspended run publishes for review. */
  readonly proposal: StoryProposal;
  /** Progress replayed up to the approval gate. */
  readonly progress: readonly ProgressEvent[];
  /** The terminal outcome an approval produces. */
  readonly approvedOutcome: Extract<StoryOutcome, { status: "approved" }>;
}

/** Builds the baseline fixture deterministically from the domain, with no I/O. */
export function buildBaselineFixture(): BaselineFixture {
  const snapshot = currentArchitectureSnapshot();
  const context = agentContextPackageSchema.parse(
    buildAgentContextPackage({ intent: BASELINE_INTENT, snapshot }),
  );

  const proposal = buildStoryProposal({
    title: BASELINE_TITLE,
    context,
    drafts: BASELINE_DRAFTS,
    analysis: BASELINE_ANALYSIS,
    critique: BASELINE_CRITIQUE,
  });

  const request: StoryRequest = {
    title: BASELINE_TITLE,
    context,
    sceneCount: BASELINE_SCENE_COUNT,
  };

  return {
    request,
    proposal,
    progress: BASELINE_PROGRESS,
    approvedOutcome: {
      status: "approved",
      proposal,
      reviewer: "preview-owner",
    },
  };
}
