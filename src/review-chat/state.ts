import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import type { StateAdapter } from "chat";

/**
 * Chooses the Chat SDK state backend for this process. Redis is the production choice — thread
 * subscriptions, the eve session bound to each thread, and the shared-package registry all live in
 * it, so they survive a redeploy and are shared across instances. Production without `REDIS_URL`
 * is refused rather than silently falling back to in-memory state that a redeploy would wipe.
 */
export function resolveReviewChatState(): StateAdapter {
  if (process.env.REDIS_URL) return createRedisState();

  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      "REDIS_URL is required in production so review-thread state survives redeploys.",
    );
  }

  return createMemoryState();
}
