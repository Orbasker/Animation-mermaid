import { Client } from "eve/client";
import type { StreamChunk } from "chat";

import type { ValidatedAgentContext } from "@/workflows/design-review-story/contract";

import { chunksFromEveEvents } from "./stream-bridge";

/** One question put to the review agent about a shared package. */
export interface ReviewQuestion {
  /** The eve session to continue, or `undefined` to open one bound to this package. */
  readonly sessionId: string | undefined;
  readonly pkg: ValidatedAgentContext;
  readonly question: string;
}

/** A streamed answer, paired with the session it belongs to so the thread can continue it. */
export interface ReviewAnswer {
  readonly sessionId: string;
  readonly stream: AsyncIterable<string | StreamChunk>;
}

/**
 * The bot's view of the design-review agent. One thread maps to one session; the first question
 * opens that session seeded with the shared package, and every later question continues it. The
 * agent is the *same* eve agent the story workflow uses — reached the same way — so a Slack answer
 * and a generated storyboard reason over identical semantic context.
 */
export interface ReviewAgent {
  ask(input: ReviewQuestion): Promise<ReviewAnswer>;
}

function describePackage(pkg: ValidatedAgentContext): string {
  const nodes = pkg.graph.entities.filter((entity) => entity.kind === "node");
  const edges = pkg.graph.entities.filter((entity) => entity.kind === "edge");
  const groups = pkg.graph.entities.filter((entity) => entity.kind === "group");

  const lines = [
    `Diagram type: ${pkg.graph.diagramType}`,
    `Snapshot: ${pkg.graph.snapshotId}`,
    "",
    "Nodes (id — label):",
    ...nodes.map((node) =>
      node.kind === "node" ? `- ${node.id} — ${node.label}` : "",
    ),
  ];

  if (groups.length > 0) {
    lines.push("", "Groups (id — label — members):");
    for (const group of groups) {
      if (group.kind !== "group") continue;
      lines.push(
        `- ${group.id} — ${group.label} — ${group.memberIds.join(", ")}`,
      );
    }
  }

  if (edges.length > 0) {
    lines.push("", "Edges (id — source -> target — label):");
    for (const edge of edges) {
      if (edge.kind !== "edge") continue;
      lines.push(
        `- ${edge.id} — ${edge.source} -> ${edge.target}${edge.label ? ` — ${edge.label}` : ""}`,
      );
    }
  }

  if (pkg.comparison) {
    lines.push(
      "",
      `Comparison ${pkg.comparison.baseSnapshotId} -> ${pkg.comparison.targetSnapshotId}:`,
      ...pkg.comparison.changes.map(
        (change) => `- ${change.op} ${change.entityId}`,
      ),
    );
  }

  return lines.join("\n");
}

/**
 * The first message of a thread's session. It hands over the shared package and constrains the
 * agent to it, so a follow-up answer draws only on what was explicitly shared — never on a diagram
 * the reviewer happens to have open locally.
 */
export function seedPrompt(
  pkg: ValidatedAgentContext,
  question: string,
): string {
  return [
    "You are answering questions from reviewers in a Slack thread about one shared",
    "design-review package. Answer only from the package below. Do not invent components,",
    "edges, or relationships that are not in it; if a question cannot be answered from the",
    "package, say so plainly.",
    "",
    `The reviewer's original intent for this design: ${pkg.intent}`,
    "",
    describePackage(pkg),
    "",
    "The reviewer asks:",
    question,
  ].join("\n");
}

function resolveAgentHost(): string {
  const explicit = process.env.EVE_AGENT_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

/**
 * The production agent: it opens or continues an eve session over the mounted agent and streams
 * the turn's events straight through {@link chunksFromEveEvents}. The `MessageResponse` is itself
 * the turn-scoped event iterable, so the answer streamed here is exactly this question's turn.
 */
export function createEveReviewAgent(): ReviewAgent {
  const bearer = process.env.EVE_AGENT_TOKEN;
  const client = new Client({
    host: resolveAgentHost(),
    ...(bearer ? { auth: { bearer }, redirect: "manual" as const } : {}),
  });

  return {
    async ask({ sessionId, pkg, question }) {
      if (sessionId === undefined) {
        const { response } = await client.sessions.create({
          message: seedPrompt(pkg, question),
        });
        return {
          sessionId: response.sessionId,
          stream: chunksFromEveEvents(response),
        };
      }
      const session = client.sessions.attach(sessionId);
      const response = await session.send(question);
      return { sessionId, stream: chunksFromEveEvents(response) };
    },
  };
}
