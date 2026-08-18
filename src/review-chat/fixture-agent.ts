import type { StreamChunk } from "chat";

import type { ValidatedAgentContext } from "@/workflows/design-review-story/contract";

import type { ReviewAgent, ReviewAnswer, ReviewQuestion } from "./eve-agent";
import { createEveReviewAgent } from "./eve-agent";

const FIXTURE_SESSION_ID = "review-fixture-session";

function labelOf(pkg: ValidatedAgentContext): string {
  const node = pkg.graph.entities.find((entity) => entity.kind === "node");
  if (node && "label" in node) return node.label;
  return pkg.graph.entities[0]?.id ?? "the design";
}

async function* fixtureStream(
  pkg: ValidatedAgentContext,
  question: string,
): AsyncIterable<string | StreamChunk> {
  yield "From the shared review package ";
  yield `(“${pkg.intent}”), `;
  yield `the answer centers on ${labelOf(pkg)}. `;
  yield `You asked: ${question}`;
}

/**
 * Deterministic stand-in for the review agent, selected with `REVIEW_CHAT_AGENT=fixture`. It never
 * calls a model, so the bot's routing, subscription, and package-scoping behavior can be exercised
 * offline and in tests. Its answer names only content drawn from the shared package, which is what
 * lets a test assert that a follow-up references the package and nothing outside it.
 */
export function createFixtureReviewAgent(): ReviewAgent {
  return {
    async ask({
      sessionId,
      pkg,
      question,
    }: ReviewQuestion): Promise<ReviewAnswer> {
      return {
        sessionId: sessionId ?? FIXTURE_SESSION_ID,
        stream: fixtureStream(pkg, question),
      };
    },
  };
}

/**
 * Chooses the agent for this process. The fixture is refused outright in production: a
 * misconfigured environment variable there would answer reviewers with an invented stand-in
 * instead of the real agent, which is the one failure mode a review tool must not have.
 */
export function resolveReviewAgent(): ReviewAgent {
  if (process.env.REVIEW_CHAT_AGENT === "fixture") {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error(
        "REVIEW_CHAT_AGENT=fixture is not allowed in production; unset it so answers reach the eve agent.",
      );
    }
    return createFixtureReviewAgent();
  }
  return createEveReviewAgent();
}
