"use client";

import type {
  ProgressEvent,
  StoryDecision,
  StoryOutcome,
  StoryProposal,
} from "@/workflows/design-review-story";

import type { CopilotTransport } from "./copilot-transport";

/**
 * A browser-only seam for driving the copilot end-to-end without a live workflow runtime.
 *
 * The durable run holds its progress stream open while it waits for a human decision, which a
 * network-level mock cannot reproduce (an intercepted response is fully buffered, never a
 * long-lived stream). A scripted transport can: {@link streamProgress} yields the phase notes and
 * then parks on a promise until {@link decide} resolves it, exactly as the suspended run parks the
 * real stream. This keeps the Playwright approval and reconnect journeys faithful to the shipped
 * client, which talks to this transport through the same {@link CopilotTransport} interface it uses
 * for HTTP.
 *
 * It activates only when a test has installed `window.__E2E_COPILOT__`; in every other context the
 * global is absent and the editor falls back to the real HTTP transport.
 */
export interface E2ECopilotFixture {
  readonly runId: string;
  readonly progress: readonly ProgressEvent[];
  readonly proposal: StoryProposal;
  readonly approvedOutcome: Extract<StoryOutcome, { status: "approved" }>;
}

declare global {
  interface Window {
    __E2E_COPILOT__?: E2ECopilotFixture;
  }
}

function createScriptedTransport(fixture: E2ECopilotFixture): CopilotTransport {
  let decision: StoryDecision | undefined;
  let release: () => void = () => {};
  const decided = new Promise<void>((resolve) => {
    release = resolve;
  });

  function terminalOutcome(): StoryOutcome {
    if (decision?.decision === "approve") {
      return {
        status: "approved",
        proposal: fixture.proposal,
        ...(decision.reviewer !== undefined
          ? { reviewer: decision.reviewer }
          : {}),
        ...(decision.note !== undefined ? { note: decision.note } : {}),
      };
    }
    return {
      status: "rejected",
      ...(decision?.reviewer !== undefined
        ? { reviewer: decision.reviewer }
        : {}),
      ...(decision?.note !== undefined ? { note: decision.note } : {}),
    };
  }

  return {
    async start() {
      return { runId: fixture.runId };
    },
    async status(runId) {
      if (decision)
        return { runId, status: "completed", outcome: terminalOutcome() };
      return { runId, status: "running" };
    },
    async *streamProgress(_runId, options) {
      const start = options?.startIndex ?? 0;
      for (const event of fixture.progress.slice(start)) {
        if (options?.signal?.aborted) return;
        yield event;
      }
      // Hold the stream open the way a suspended run does — until a decision lands.
      await decided;
    },
    async proposal() {
      return fixture.proposal;
    },
    async decide(_runId, next) {
      decision = next;
      release();
    },
    async cancel() {
      release();
    },
  };
}

/**
 * The scripted transport when a test has installed a fixture, or `undefined` so the editor uses
 * its real HTTP transport. Reading it once at mount is deliberate: a run must keep the same
 * transport for its whole lifecycle.
 */
export function e2eCopilotTransportFromWindow(): CopilotTransport | undefined {
  if (typeof window === "undefined") return undefined;
  const fixture = window.__E2E_COPILOT__;
  return fixture ? createScriptedTransport(fixture) : undefined;
}
