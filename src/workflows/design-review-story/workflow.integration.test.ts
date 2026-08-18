import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRun, start } from "workflow/api";
import { waitForHook } from "@workflow/vitest";

import { buildAgentContextPackage } from "@/domain/agent-context";
import { currentArchitectureSnapshot } from "@/domain/fixtures";
import { CURRENT_SCHEMA_VERSION } from "@/domain/schema-version";

import {
  progressEventSchema,
  type ProgressEvent,
  type StoryOutcome,
  type StoryProposal,
  type StoryRequest,
} from "./contract";
import { decisionToken, storyDecisionHook } from "./hooks";
import { PROGRESS_NAMESPACE, PROPOSAL_NAMESPACE } from "./steps";
import { generateDesignReviewStory } from "./workflow";

/**
 * These tests run the real workflow against the DevKit's in-process runtime, with the
 * deterministic fixture agent standing in for eve (see `transport.ts`). What is under test is
 * the orchestration: that a run is addressable by id alone, that a retried step does not redo a
 * completed one, that a rejected proposal yields nothing applicable, and that an approved one
 * yields the same payload every time.
 */

const snapshot = currentArchitectureSnapshot();

function request(overrides: Partial<StoryRequest> = {}): StoryRequest {
  return {
    title: "Request path today",
    context: buildAgentContextPackage({
      intent: "Explain the current request path to a new reviewer.",
      snapshot,
    }),
    sceneCount: 3,
    ...overrides,
  };
}

function script(value: object | undefined): void {
  if (value === undefined) delete process.env.DESIGN_REVIEW_STORY_AGENT_SCRIPT;
  else process.env.DESIGN_REVIEW_STORY_AGENT_SCRIPT = JSON.stringify(value);
}

beforeEach(() => {
  process.env.DESIGN_REVIEW_STORY_AGENT = "fixture";
  script(undefined);
});

afterEach(() => {
  delete process.env.DESIGN_REVIEW_STORY_AGENT;
  script(undefined);
});

/**
 * Replays a run's progress stream from the beginning, as a reconnecting client would.
 *
 * Bounded by the tail index rather than read to `done`: the stream of a run that is still
 * waiting — or that failed before closing its streams — never ends, so draining it would block.
 * The tail index is the snapshot of what has been written so far, which is exactly what a
 * client reconnecting mid-run gets.
 */
async function readProgress(runId: string): Promise<readonly ProgressEvent[]> {
  const stream = getRun(runId).getReadable<ProgressEvent>({
    namespace: PROGRESS_NAMESPACE,
    startIndex: 0,
  });
  const tailIndex = await stream.getTailIndex();
  if (tailIndex < 0) return [];

  const events: ProgressEvent[] = [];
  const reader = stream.getReader();
  try {
    while (events.length <= tailIndex) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) events.push(progressEventSchema.parse(value));
    }
  } finally {
    reader.releaseLock();
  }
  return events;
}

describe("generateDesignReviewStory", () => {
  it("returns a proposal that validates against the project schema when approved", async () => {
    const run = await start(generateDesignReviewStory, [request()]);
    const hook = await waitForHook(run, { token: decisionToken(run.runId) });

    await storyDecisionHook.resume(hook.token, {
      decision: "approve",
      reviewer: "alice",
    });

    const outcome = (await run.returnValue) as StoryOutcome;

    expect(outcome.status).toBe("approved");
    if (outcome.status !== "approved") return;
    expect(outcome.reviewer).toBe("alice");
    expect(outcome.proposal.story.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(outcome.proposal.story.snapshotId).toBe("snap-current");
    expect(outcome.proposal.story.scenes).toHaveLength(3);
    expect(outcome.proposal.story.scenes.map((scene) => scene.id)).toEqual([
      "scene-1",
      "scene-2",
      "scene-3",
    ]);
    expect(outcome.proposal.totalDurationMs).toBe(6_000);
    expect(await run.status).toBe("completed");
  });

  it("publishes the proposal for review while suspended, before any decision", async () => {
    const run = await start(generateDesignReviewStory, [request()]);
    // Reached the gate, but the reviewer has not decided — the run is still suspended.
    await waitForHook(run, { token: decisionToken(run.runId) });

    const reader = getRun(run.runId)
      .getReadable<StoryProposal>({
        namespace: PROPOSAL_NAMESPACE,
        startIndex: 0,
      })
      .getReader();
    const { value, done } = await reader.read();
    await reader.cancel().catch(() => undefined);

    expect(done).toBe(false);
    expect(value?.story.snapshotId).toBe("snap-current");
    expect(value?.story.scenes).toHaveLength(3);
    // Seeing the proposal is not applying it: the run has not settled.
    expect(await run.status).not.toBe("completed");

    await storyDecisionHook.resume(decisionToken(run.runId), {
      decision: "reject",
    });
    await run.returnValue;
  });

  it("returns the same proposal payload for two runs of the same request", async () => {
    const first = await start(generateDesignReviewStory, [request()]);
    const firstHook = await waitForHook(first, {
      token: decisionToken(first.runId),
    });
    await storyDecisionHook.resume(firstHook.token, { decision: "approve" });
    const a = (await first.returnValue) as StoryOutcome;

    const second = await start(generateDesignReviewStory, [request()]);
    const secondHook = await waitForHook(second, {
      token: decisionToken(second.runId),
    });
    await storyDecisionHook.resume(secondHook.token, { decision: "approve" });
    const b = (await second.returnValue) as StoryOutcome;

    expect(a.status).toBe("approved");
    expect(b.status).toBe("approved");
    if (a.status !== "approved" || b.status !== "approved") return;
    expect(b.proposal).toEqual(a.proposal);
    expect(b.proposal.proposalId).toBe(a.proposal.proposalId);
  });

  it("resumes from the run id alone, with nothing but the id carried across", async () => {
    const started = await start(generateDesignReviewStory, [request()]);
    const runId = started.runId;
    await waitForHook(started, { token: decisionToken(runId) });

    // Everything after this point uses only `runId` — the stand-in for a client that reloaded
    // and has nothing left but the id it stored.
    const rejoined = getRun<StoryOutcome>(runId);

    expect(await rejoined.exists).toBe(true);
    expect(await rejoined.status).toBe("running");

    // Replaying by id alone recovers the work already done, so a reloaded client can render
    // where the run got to instead of starting over. The `awaiting-approval` gate phase may or
    // may not have streamed by the instant the decision hook is waiting, so assert on the
    // pre-gate work that must be present and that the run has not settled — not on the racy
    // trailing event.
    const midRun = (await readProgress(runId))
      .filter((event) => event.attempt === undefined)
      .map((event) => event.phase);
    expect(midRun.slice(0, 4)).toEqual([
      "validating-context",
      "analyzing-narrative",
      "generating-scenes",
      "critiquing",
    ]);
    expect(midRun).not.toContain("settled");

    await storyDecisionHook.resume(decisionToken(runId), {
      decision: "approve",
    });
    const outcome = await rejoined.returnValue;

    expect(outcome.status).toBe("approved");

    const settled = (await readProgress(runId))
      .filter((event) => event.attempt === undefined)
      .map((event) => event.phase);
    expect(settled.slice(-2)).toEqual(["awaiting-approval", "settled"]);
  });

  it("reports a missing run rather than inventing one", async () => {
    expect(await getRun("wrun_does_not_exist").exists).toBe(false);
  });

  it("retries a transient agent failure without re-running completed steps", async () => {
    // Scene generation fails its first two attempts; the narrative analysis before it and the
    // critique after it succeed first time.
    script({ failures: { scenes: 2 } });

    const run = await start(generateDesignReviewStory, [request()]);
    const hook = await waitForHook(run, { token: decisionToken(run.runId) });
    await storyDecisionHook.resume(hook.token, { decision: "approve" });
    const outcome = (await run.returnValue) as StoryOutcome;

    expect(outcome.status).toBe("approved");

    // Each attempt writes its own note, so the notes are a ledger of what actually ran.
    const attempts = (await readProgress(run.runId)).filter(
      (event) => event.attempt !== undefined,
    );
    const perPhase = (phase: string) =>
      attempts
        .filter((event) => event.phase === phase)
        .map((event) => event.attempt);

    expect(perPhase("generating-scenes")).toEqual([1, 2, 3]);
    expect(perPhase("analyzing-narrative")).toEqual([1]);
    expect(perPhase("critiquing")).toEqual([1]);
  });

  it("announces each phase exactly once even when a phase is retried", async () => {
    script({ failures: { scenes: 2 } });

    const run = await start(generateDesignReviewStory, [request()]);
    const hook = await waitForHook(run, { token: decisionToken(run.runId) });
    await storyDecisionHook.resume(hook.token, { decision: "approve" });
    await run.returnValue;

    const transitions = (await readProgress(run.runId))
      .filter((event) => event.attempt === undefined)
      .map((event) => event.phase);

    expect(transitions).toEqual([
      "validating-context",
      "analyzing-narrative",
      "generating-scenes",
      "critiquing",
      "awaiting-approval",
      "settled",
    ]);
  });

  it("gives up after the retry budget instead of retrying forever", async () => {
    script({ failures: { analyze: 99 } });

    const run = await start(generateDesignReviewStory, [request()]);

    await expect(run.returnValue).rejects.toThrow();
    expect(await run.status).toBe("failed");
  });

  it("does not retry a request the agent rejects outright", async () => {
    script({ failures: { analyze: 99 }, failureStatus: 400 });

    const run = await start(generateDesignReviewStory, [request()]);

    await expect(run.returnValue).rejects.toThrow();

    const attempts = (await readProgress(run.runId)).filter(
      (event) =>
        event.phase === "analyzing-narrative" && event.attempt !== undefined,
    );

    expect(attempts).toHaveLength(1);
  });

  it("returns nothing applicable when the proposal is rejected", async () => {
    const run = await start(generateDesignReviewStory, [request()]);
    const hook = await waitForHook(run, { token: decisionToken(run.runId) });

    await storyDecisionHook.resume(hook.token, {
      decision: "reject",
      reviewer: "bob",
      note: "The second beat misreads the gateway.",
    });

    const outcome = (await run.returnValue) as StoryOutcome;

    expect(outcome.status).toBe("rejected");
    expect(outcome).not.toHaveProperty("proposal");
    expect(outcome.reviewer).toBe("bob");
    expect(outcome.note).toBe("The second beat misreads the gateway.");
    expect(await run.status).toBe("completed");
  });

  it("can be cancelled while it waits for a decision, producing no outcome", async () => {
    const run = await start(generateDesignReviewStory, [request()]);
    await waitForHook(run, { token: decisionToken(run.runId) });

    await getRun(run.runId).cancel();

    expect(await getRun(run.runId).status).toBe("cancelled");
    await expect(getRun(run.runId).returnValue).rejects.toThrow();
  });

  it("fails a malformed context package without calling the agent", async () => {
    const run = await start(generateDesignReviewStory, [
      // Layout data is exactly what the context boundary exists to keep out.
      {
        ...request(),
        context: {
          ...request().context,
          layout: [{ entityId: "api", x: 1, y: 2 }],
        },
      } as StoryRequest,
    ]);

    await expect(run.returnValue).rejects.toThrow();
    expect(await run.status).toBe("failed");

    const phases = (await readProgress(run.runId)).map((event) => event.phase);

    expect(phases).toEqual(["validating-context"]);
  });

  it("refuses a draft that names an entity outside the graph", async () => {
    script({ unknownEntity: true });

    const run = await start(generateDesignReviewStory, [request()]);

    await expect(run.returnValue).rejects.toThrow();
    expect(await run.status).toBe("failed");
  });

  it("keeps the settled outcome out of the progress stream", async () => {
    const run = await start(generateDesignReviewStory, [request()]);
    const hook = await waitForHook(run, { token: decisionToken(run.runId) });
    await storyDecisionHook.resume(hook.token, { decision: "approve" });
    await run.returnValue;

    for (const event of await readProgress(run.runId)) {
      expect(event).not.toHaveProperty("proposal");
      expect(event).not.toHaveProperty("story");
    }
  });

  it("streams the settled outcome on the default namespace", async () => {
    const run = await start(generateDesignReviewStory, [request()]);
    const hook = await waitForHook(run, { token: decisionToken(run.runId) });
    await storyDecisionHook.resume(hook.token, { decision: "approve" });
    await run.returnValue;

    const chunks: unknown[] = [];
    const reader = getRun(run.runId).getReadable({ startIndex: 0 }).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ status: "approved" });
  });

  it("does not resume a run that is not waiting for a decision", async () => {
    const run = await start(generateDesignReviewStory, [request()]);
    const hook = await waitForHook(run, { token: decisionToken(run.runId) });
    await storyDecisionHook.resume(hook.token, { decision: "approve" });
    await run.returnValue;

    // The hook is consumed, so a second decision has nothing to resume. The decision route
    // turns this into a 409 rather than letting a late approval land on a settled run.
    await expect(
      storyDecisionHook.resume(decisionToken(run.runId), {
        decision: "reject",
      }),
    ).rejects.toThrow();
  });
});
