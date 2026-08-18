import { getReviewChatBot } from "@/review-chat";

/**
 * Slack's events + interactivity webhook. The Chat SDK's Slack adapter verifies the request
 * signature against `SLACK_SIGNING_SECRET` before any handler runs — an invalid or missing
 * signature is answered `401` and never dispatched — and deduplicates redelivered events, so
 * Slack's retries do not produce a second answer.
 */
export async function POST(request: Request): Promise<Response> {
  const { bot } = getReviewChatBot();
  return bot.webhooks.slack(request);
}
