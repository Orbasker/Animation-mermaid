import type { StreamChunk } from "chat";

import type { ReviewAgent } from "./eve-agent";
import type { ReviewShareStore } from "./share-store";
import { parseShareRef } from "./share-ref";
import { AgentTurnFailedError, degradeToText } from "./stream-bridge";

/**
 * The durable binding the bot keeps on a thread: the one shared package this thread is about and,
 * once the first answer opens it, the eve session that carries the conversation. Persisted through
 * the Chat SDK state adapter, so a redeploy rejoins the same package and session rather than
 * starting over.
 */
export interface ReviewThreadState {
  readonly shareId: string;
  readonly sessionId?: string;
}

/**
 * The slice of a Chat SDK `Thread` the review handlers use. Narrowing to a port keeps the routing
 * logic testable without a live Slack webhook, and a real `Thread` satisfies it directly.
 */
export interface ReviewThread {
  readonly id: string;
  subscribe(): Promise<void>;
  post(message: string | AsyncIterable<string | StreamChunk>): Promise<unknown>;
  startTyping(): Promise<void>;
  readonly state: Promise<ReviewThreadState | null>;
  setState(state: ReviewThreadState): Promise<unknown>;
}

export interface ReviewHandlerDeps {
  readonly store: ReviewShareStore;
  readonly agent: ReviewAgent;
  /**
   * Whether to stream structured chunks to the platform. When `false`, answers are flattened to
   * text first, the graceful-degradation path for a channel that cannot represent them.
   */
  readonly structuredStreaming: boolean;
}

const NO_SHARE_MESSAGE =
  "Mention me together with a shared review link or code (it looks like `rev_…`) and I'll answer questions about that design review.";

const UNKNOWN_SHARE_MESSAGE =
  "I couldn't find a shared review package for that code. Only reviews that have been explicitly shared can be discussed here.";

const REVOKED_SHARE_MESSAGE =
  "The review package for this thread is no longer available, so I can't answer further questions about it.";

const DEFAULT_QUESTION = "Give a brief overview of this design review.";

/**
 * First contact: a mention in an unsubscribed thread. Binds the thread to exactly one shared
 * package (rejecting a mention that names none or an unknown one), subscribes so follow-ups route
 * here, and answers the opening question.
 */
export async function handleMention(
  thread: ReviewThread,
  text: string,
  deps: ReviewHandlerDeps,
): Promise<void> {
  const ref = parseShareRef(text);
  if (!ref) {
    await thread.post(NO_SHARE_MESSAGE);
    return;
  }

  const pkg = await deps.store.get(ref);
  if (!pkg) {
    await thread.post(UNKNOWN_SHARE_MESSAGE);
    return;
  }

  await thread.subscribe();
  await thread.setState({ shareId: ref });
  await answer(thread, { shareId: ref }, questionFrom(text, ref), deps, pkg);
}

/**
 * A message in a thread already bound to a package. The package is re-resolved from its share id
 * every turn, so an answer can only ever draw on what was explicitly shared — never on a caller's
 * local project. An unbound thread is ignored: nothing was shared to talk about.
 */
export async function handleFollowUp(
  thread: ReviewThread,
  text: string,
  deps: ReviewHandlerDeps,
): Promise<void> {
  const state = await thread.state;
  if (!state?.shareId) return;

  const pkg = await deps.store.get(state.shareId);
  if (!pkg) {
    await thread.post(REVOKED_SHARE_MESSAGE);
    return;
  }

  await answer(thread, state, questionFrom(text), deps, pkg);
}

async function answer(
  thread: ReviewThread,
  state: ReviewThreadState,
  question: string,
  deps: ReviewHandlerDeps,
  pkg: Awaited<ReturnType<ReviewShareStore["get"]>>,
): Promise<void> {
  if (pkg === null) return;
  await thread.startTyping();

  const { sessionId, stream } = await deps.agent.ask({
    sessionId: state.sessionId,
    pkg,
    question,
  });

  if (sessionId !== state.sessionId) {
    await thread.setState({ shareId: state.shareId, sessionId });
  }

  const outbound = deps.structuredStreaming ? stream : degradeToText(stream);
  try {
    await thread.post(outbound);
  } catch (error) {
    if (error instanceof AgentTurnFailedError) {
      await thread.post(`I couldn't answer that: ${error.message}`);
      return;
    }
    throw error;
  }
}

/** Strips the bot's share reference from a mention, leaving the reviewer's actual question. */
function questionFrom(text: string, ref?: string): string {
  const withoutRef = ref ? text.split(ref).join(" ") : text;
  const cleaned = withoutRef.replace(/<@[^>]+>/g, " ").trim();
  return cleaned.length > 0 ? cleaned : DEFAULT_QUESTION;
}
