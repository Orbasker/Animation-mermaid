import { createReviewChatBot, type ReviewChatBot } from "./bot";
import { resolveReviewChatState } from "./state";

export { createReviewChatBot, type ReviewChatBot, type ReviewChatBotOptions } from "./bot";
export {
  createStateBackedShareStore,
  shareIdFor,
  InvalidReviewPackageError,
  type ReviewShareStore,
} from "./share-store";
export { parseShareRef } from "./share-ref";
export {
  handleMention,
  handleFollowUp,
  type ReviewThread,
  type ReviewThreadState,
  type ReviewHandlerDeps,
} from "./handlers";
export { createEveReviewAgent, seedPrompt, type ReviewAgent } from "./eve-agent";
export { createFixtureReviewAgent, resolveReviewAgent } from "./fixture-agent";
export { chunksFromEveEvents, degradeToText, AgentTurnFailedError } from "./stream-bridge";
export { resolveReviewChatState } from "./state";

let singleton: ReviewChatBot | null = null;

/**
 * The process-wide bot, built lazily from the environment on first use. Construction is deferred
 * so importing a route never fails a build that lacks runtime credentials; the state backend and
 * agent are only resolved when a webhook actually arrives.
 */
export function getReviewChatBot(): ReviewChatBot {
  if (singleton === null) {
    singleton = createReviewChatBot({ state: resolveReviewChatState() });
  }
  return singleton;
}
