import { Chat, StreamingPlan } from "chat";
import type { StateAdapter, StreamChunk, Thread } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import type { SlackAdapter } from "@chat-adapter/slack";

import { resolveReviewAgent } from "./fixture-agent";
import type { ReviewAgent } from "./eve-agent";
import {
  handleFollowUp,
  handleMention,
  type ReviewHandlerDeps,
  type ReviewThread,
  type ReviewThreadState,
} from "./handlers";
import { createStateBackedShareStore, type ReviewShareStore } from "./share-store";

/** Ten minutes: Slack retries an unacknowledged event for a few minutes, so dedupe must outlast that. */
const DEDUPE_TTL_MS = 600_000;

export interface ReviewChatBotOptions {
  readonly state: StateAdapter;
  /** Defaults to `createSlackAdapter()`, which reads `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET`. */
  readonly slack?: SlackAdapter;
  /** Defaults to {@link resolveReviewAgent}; injected in tests. */
  readonly agent?: ReviewAgent;
  readonly userName?: string;
  /** Stream structured chunks (Slack) rather than flattening to text. Defaults to `true`. */
  readonly structuredStreaming?: boolean;
}

export interface ReviewChatBot {
  readonly bot: Chat;
  readonly store: ReviewShareStore;
}

/**
 * Bridges a live Chat SDK `Thread` to the {@link ReviewThread} port the handlers use. A stream is
 * posted through {@link StreamingPlan} so structured chunks reach Slack as task cards while plain
 * text still posts as text; a bare string posts directly.
 */
function toReviewThread(thread: Thread<ReviewThreadState>): ReviewThread {
  return {
    id: thread.id,
    subscribe: () => thread.subscribe(),
    startTyping: () => thread.startTyping(),
    setState: (state) => thread.setState(state),
    get state() {
      return thread.state;
    },
    post: (message: string | AsyncIterable<string | StreamChunk>) =>
      typeof message === "string" ? thread.post(message) : thread.post(new StreamingPlan(message)),
  };
}

/**
 * Assembles the design-review Slack bot. A mention that names a shared package subscribes the
 * thread and answers from that package; every later message in the thread continues the same eve
 * session, scoped to the same package. Locks force-release so a follow-up can interrupt a
 * still-streaming answer, and identical redelivered webhooks are dropped within the dedupe window.
 */
export function createReviewChatBot(options: ReviewChatBotOptions): ReviewChatBot {
  const bot = new Chat({
    userName: options.userName ?? "design-review",
    adapters: { slack: options.slack ?? createSlackAdapter() },
    state: options.state,
    dedupeTtlMs: DEDUPE_TTL_MS,
    onLockConflict: "force",
  });

  const deps: ReviewHandlerDeps = {
    store: createStateBackedShareStore(options.state),
    agent: options.agent ?? resolveReviewAgent(),
    structuredStreaming: options.structuredStreaming ?? true,
  };

  bot.onNewMention((thread, message) =>
    handleMention(toReviewThread(thread as Thread<ReviewThreadState>), message.text, deps),
  );
  bot.onSubscribedMessage((thread, message) =>
    handleFollowUp(toReviewThread(thread as Thread<ReviewThreadState>), message.text, deps),
  );

  return { bot, store: deps.store };
}
