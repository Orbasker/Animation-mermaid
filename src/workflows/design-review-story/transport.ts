import { Client } from "eve/client";

/** One question put to the agent. */
export interface AgentTurn {
  /** Session to continue, or `undefined` to open a new one. */
  readonly sessionId: string | undefined;
  readonly prompt: string;
  /** Standard Schema the turn must satisfy; eve lowers it to JSON Schema. */
  readonly outputSchema: unknown;
  /** Which bounded question this is. Only the fixture transport reads it. */
  readonly phase: "analyze" | "scenes" | "critique";
  /** 1-based step attempt. Only the fixture transport reads it. */
  readonly attempt: number;
}

export interface AgentReplyEnvelope {
  readonly data: unknown;
  readonly sessionId: string;
}

export interface AgentTransport {
  turn(input: AgentTurn): Promise<AgentReplyEnvelope>;
}

/**
 * Where the eve agent is reachable. The agent is mounted into this same Next.js app, so in a
 * deployed environment the app's own origin is the right default; `EVE_AGENT_URL` overrides it
 * for a split deployment or a remote agent.
 */
function resolveAgentHost(): string {
  const explicit = process.env.EVE_AGENT_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

function eveTransport(): AgentTransport {
  const bearer = process.env.EVE_AGENT_TOKEN;
  const client = new Client({
    host: resolveAgentHost(),
    ...(bearer ? { auth: { bearer }, redirect: "manual" as const } : {}),
  });

  return {
    async turn(input) {
      const options = { outputSchema: input.outputSchema as Record<string, never> };

      if (input.sessionId === undefined) {
        const { response } = await client.sessions.create({
          message: input.prompt,
          ...options,
        });
        const result = await response.result();
        return { data: result.data, sessionId: response.sessionId };
      }

      const session = client.sessions.attach(input.sessionId);
      const response = await session.send(input.prompt, options);
      const result = await response.result();
      return { data: result.data, sessionId: input.sessionId };
    },
  };
}

/**
 * Deterministic stand-in for the agent, selected with `DESIGN_REVIEW_STORY_AGENT=fixture`.
 *
 * The durability guarantees this workflow exists to provide — a run that survives a reload, a
 * transient model failure that retries without redoing completed work — are properties of the
 * orchestration, not of any particular model output. Exercising them needs an agent whose
 * replies and failures are both reproducible, which no real model is. This transport supplies
 * that, and doubles as a way to drive the flow locally without a Gateway credential.
 *
 * Scripted through `DESIGN_REVIEW_STORY_AGENT_SCRIPT` (JSON):
 *
 * - `failures`: per-phase count of leading attempts that fail. Keyed off the step's attempt
 *   number rather than a counter, so behavior does not depend on how many times the module
 *   happened to be loaded.
 * - `failureStatus`: HTTP-ish status to fail with, so both the retryable and fatal branches of
 *   `classifyAgentError` can be driven.
 * - `unknownEntity`: emit a scene naming an entity the graph does not contain, to exercise the
 *   schema check that guards the proposal.
 * - `sceneCount`: how many scenes to emit, independent of what was asked for.
 */
interface FixtureScript {
  readonly failures?: Partial<Record<AgentTurn["phase"], number>>;
  readonly failureStatus?: number;
  readonly unknownEntity?: boolean;
  readonly sceneCount?: number;
}

class FixtureTransportError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number) {
    super(`Fixture agent failure with status ${status}.`);
    this.name = "FixtureTransportError";
    this.status = status;
    this.body = "scripted fixture failure";
  }
}

function readScript(): FixtureScript {
  const raw = process.env.DESIGN_REVIEW_STORY_AGENT_SCRIPT;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as FixtureScript;
  } catch (error) {
    throw new Error(
      `DESIGN_REVIEW_STORY_AGENT_SCRIPT is not valid JSON: ${(error as Error).message}`,
    );
  }
}

/**
 * The context the fixture answers about. Recovered from the prompt, which lists every allowed
 * entity id: the transport interface deliberately carries only a prompt, so the fixture reads
 * the same closed set the model would.
 */
function idsFromPrompt(prompt: string): readonly string[] {
  const match = /(?:Use only these entity ids|Every id you name must be one of): ([^\n.]+)/.exec(
    prompt,
  );
  if (!match) return [];
  return match[1]
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function fixtureTransport(): AgentTransport {
  const script = readScript();

  return {
    async turn(input) {
      const failures = script.failures?.[input.phase] ?? 0;
      if (input.attempt <= failures) {
        throw new FixtureTransportError(script.failureStatus ?? 503);
      }

      const sessionId = input.sessionId ?? "fixture-session";
      const ids = idsFromPrompt(input.prompt);

      switch (input.phase) {
        case "analyze":
          return {
            sessionId,
            data: {
              thesis: "The proposed architecture moves request fan-out behind one gateway.",
              audience: "Engineers reviewing the migration.",
              beats: ids.slice(0, 3).map((id, index) => ({
                summary: `Beat ${index + 1} concerns ${id}.`,
                entityIds: [id],
              })),
            },
          };

        case "scenes": {
          const count = script.sceneCount ?? Math.min(3, Math.max(1, ids.length));
          const targets = Array.from({ length: count }, (_, index) =>
            script.unknownEntity && index === 0
              ? "entity-that-does-not-exist"
              : (ids[index % Math.max(1, ids.length)] ?? "missing"),
          );
          return {
            sessionId,
            data: {
              scenes: targets.map((target, index) => ({
                title: `Scene ${index + 1}`,
                durationMs: 2_000,
                actions: [
                  { type: "reveal", target },
                  { type: "annotate", target, text: `Step ${index + 1}.` },
                ],
              })),
            },
          };
        }

        case "critique":
          return {
            sessionId,
            data: {
              verdict: "ready_with_notes",
              summary: "The scenes follow the thesis; pacing on the final beat is tight.",
              notes: [{ note: "Consider a longer hold on the last scene." }],
            },
          };
      }
    },
  };
}

/**
 * Chooses the transport for this process. The fixture is refused outright in production: a
 * misconfigured environment variable there would silently return invented scenes instead of
 * failing, which is the one failure mode a design-review tool must not have.
 */
export function resolveAgentTransport(): AgentTransport {
  if (process.env.DESIGN_REVIEW_STORY_AGENT === "fixture") {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error(
        "DESIGN_REVIEW_STORY_AGENT=fixture is not allowed in production; unset it so runs reach the eve agent.",
      );
    }
    return fixtureTransport();
  }
  return eveTransport();
}
