import type {
  ProgressEvent,
  StoryDecision,
  StoryOutcome,
  StoryProposal,
  StoryRequest,
} from "@/workflows/design-review-story";

/**
 * The copilot's view of the durable design-review workflow.
 *
 * The editor never talks to the Workflow DevKit directly: it goes through this transport, so
 * the run lifecycle (start, reconnect, watch progress, decide, cancel) is one small,
 * substitutable surface. The HTTP implementation drives the `/api/design-review-story`
 * endpoints; tests inject a scripted one to exercise the panel without a running workflow.
 */

/** How a run failed, coarse enough to drive one clear next action per case. */
export type CopilotErrorKind =
  | "budget"
  | "rate-limit"
  | "provider"
  | "validation"
  | "network"
  | "canceled"
  | "unknown";

/** A run failure translated for a human: what happened and what to do about it. */
export interface CopilotError {
  readonly kind: CopilotErrorKind;
  /** The raw failure detail, preserved for support and debugging. */
  readonly message: string;
  /** A short, actionable sentence telling the reviewer what to do next. */
  readonly nextAction: string;
}

/** A terminal or in-flight view of a run, as the status endpoint reports it. */
export interface RunSnapshot {
  readonly runId: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
  readonly outcome?: StoryOutcome;
  readonly error?: CopilotError;
}

export interface CopilotTransport {
  /** Starts a run and returns its durable id. */
  start(request: StoryRequest, signal?: AbortSignal): Promise<{ readonly runId: string }>;
  /** Reads the current status, and the outcome or failure once the run has one. */
  status(runId: string, signal?: AbortSignal): Promise<RunSnapshot>;
  /**
   * Yields progress events as they arrive, resuming from `startIndex`. The iterator ends when
   * the run closes its progress stream; a reconnecting client re-subscribes and reads status
   * to learn the terminal outcome.
   */
  streamProgress(
    runId: string,
    options?: { readonly startIndex?: number; readonly signal?: AbortSignal },
  ): AsyncIterable<ProgressEvent>;
  /**
   * Reads the proposal a suspended run is waiting on, or `undefined` if the run has not reached
   * the approval gate yet. Seeing the proposal is how the reviewer decides; it is not applying.
   */
  proposal(runId: string, signal?: AbortSignal): Promise<StoryProposal | undefined>;
  /** Submits the human decision a paused run is waiting on. */
  decide(runId: string, decision: StoryDecision, signal?: AbortSignal): Promise<void>;
  /** Cancels a run before it settles. */
  cancel(runId: string, signal?: AbortSignal): Promise<void>;
}

const NEXT_ACTION: Record<CopilotErrorKind, string> = {
  budget:
    "The AI Gateway budget is exhausted. Add credit or raise the budget, then start a new run.",
  "rate-limit":
    "The model provider is rate limiting requests. Wait a moment, then start a new run.",
  provider:
    "The model provider returned an error. Your local project is unchanged — start a new run to try again.",
  validation:
    "The request could not be processed as sent. Adjust the intent or context selection and start a new run.",
  network: "Could not reach the workflow service. Check your connection, then try again.",
  canceled: "The run was cancelled. Your local project is unchanged.",
  unknown:
    "Something went wrong. Your local project is unchanged — start a new run to try again.",
};

function copilotError(kind: CopilotErrorKind, message: string): CopilotError {
  return { kind, message, nextAction: NEXT_ACTION[kind] };
}

/**
 * Classifies a workflow failure message into an actionable error.
 *
 * The message is the reason the run recorded when it failed — the text of the `FatalError` or
 * exhausted `RetryableError` thrown deep in the agent step, which carries the upstream HTTP
 * status. Matching on that is how a Gateway budget cap (402/403, "budget"/"quota"/"credit") is
 * told apart from a rate limit (429), a provider fault (5xx), and a caller-side validation
 * failure — each of which needs a different next step.
 */
export function classifyFailureMessage(message: string): CopilotError {
  const text = message.toLowerCase();

  if (/\b(402|403)\b/.test(text) || /budget|quota|credit|insufficient funds/.test(text)) {
    return copilotError("budget", message);
  }
  if (/\b429\b/.test(text) || /rate limit/.test(text)) {
    return copilotError("rate-limit", message);
  }
  if (
    /context package is not valid|did not match the required schema|no-scenes|unknown-entity-reference|story-schema-invalid/.test(
      text,
    )
  ) {
    return copilotError("validation", message);
  }
  if (/\b5\d\d\b/.test(text) || /provider|gateway|upstream|timed out|timeout/.test(text)) {
    return copilotError("provider", message);
  }
  return copilotError("unknown", message);
}

/** Reads a JSON error body, tolerating a non-JSON one. */
async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // fall through to status text
  }
  return `${response.status} ${response.statusText}`.trim();
}

/**
 * The HTTP transport against this app's own `/api/design-review-story` routes.
 *
 * `baseUrl` defaults to same-origin (empty prefix), which is what the browser uses; it is
 * injectable so a non-browser caller can point at an absolute origin.
 */
export function createHttpCopilotTransport(baseUrl = ""): CopilotTransport {
  const root = `${baseUrl}/api/design-review-story`;

  return {
    async start(request, signal) {
      const response = await fetch(root, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`Could not start the run: ${await readError(response)}`);
      }
      const body = (await response.json()) as { runId: string };
      return { runId: body.runId };
    },

    async status(runId, signal) {
      const response = await fetch(`${root}/${encodeURIComponent(runId)}`, {
        ...(signal ? { signal } : {}),
      });
      if (response.status === 404) {
        return { runId, status: "cancelled" };
      }
      if (!response.ok) {
        throw new Error(`Could not read run status: ${await readError(response)}`);
      }
      const body = (await response.json()) as {
        status: RunSnapshot["status"];
        outcome?: StoryOutcome;
        error?: string;
      };
      return {
        runId,
        status: body.status,
        ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
        ...(body.status === "failed"
          ? { error: classifyFailureMessage(body.error ?? "The run failed.") }
          : {}),
      };
    },

    async *streamProgress(runId, options) {
      const query =
        options?.startIndex !== undefined ? `?startIndex=${options.startIndex}` : "";
      const response = await fetch(
        `${root}/${encodeURIComponent(runId)}/progress${query}`,
        { ...(options?.signal ? { signal: options.signal } : {}) },
      );
      if (!response.ok || !response.body) {
        throw new Error(`Could not read progress: ${await readError(response)}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line.length > 0) yield JSON.parse(line) as ProgressEvent;
            newline = buffer.indexOf("\n");
          }
        }
        const tail = buffer.trim();
        if (tail.length > 0) yield JSON.parse(tail) as ProgressEvent;
      } finally {
        reader.releaseLock();
      }
    },

    async proposal(runId, signal) {
      const response = await fetch(
        `${root}/${encodeURIComponent(runId)}/proposal`,
        { ...(signal ? { signal } : {}) },
      );
      if (response.status === 404 || response.status === 425) {
        return undefined;
      }
      if (!response.ok) {
        throw new Error(`Could not read the proposal: ${await readError(response)}`);
      }
      const body = (await response.json()) as { proposal: StoryProposal };
      return body.proposal;
    },

    async decide(runId, decision, signal) {
      const response = await fetch(
        `${root}/${encodeURIComponent(runId)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(decision),
          ...(signal ? { signal } : {}),
        },
      );
      if (!response.ok) {
        throw new Error(`Could not submit the decision: ${await readError(response)}`);
      }
    },

    async cancel(runId, signal) {
      const response = await fetch(`${root}/${encodeURIComponent(runId)}`, {
        method: "DELETE",
        ...(signal ? { signal } : {}),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Could not cancel the run: ${await readError(response)}`);
      }
    },
  };
}
