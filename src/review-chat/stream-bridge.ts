import { isCurrentTurnBoundaryEvent, isTurnFailureEvent } from "eve/client";
import type { MessageStreamEvent } from "eve/client";
import type { StreamChunk } from "chat";

/**
 * Raised when the agent's turn ends in a failure event. The bot turns this into a plain reply so
 * a model or transport fault reads as an answer the reviewer can see, not a silently dropped
 * stream.
 */
export class AgentTurnFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTurnFailedError";
  }
}

/**
 * Translates one eve turn's event stream into the `string | StreamChunk` sequence the Chat SDK
 * posts. Assistant text deltas become plain strings — the answer itself — while subagent activity
 * becomes `task_update` chunks so a reviewer sees tool work as it happens on platforms that render
 * it. Reasoning deltas are deliberately dropped; a design-review answer shows conclusions, not the
 * model's private working.
 *
 * Iteration stops at the current turn's boundary, so a shared session that has already produced
 * earlier turns streams only the answer to the latest question.
 */
export async function* chunksFromEveEvents(
  events: AsyncIterable<MessageStreamEvent>,
): AsyncIterable<string | StreamChunk> {
  for await (const event of events) {
    if (isTurnFailureEvent(event)) {
      const message =
        "message" in event.data && typeof event.data.message === "string"
          ? event.data.message
          : "The agent could not answer this turn.";
      throw new AgentTurnFailedError(message);
    }

    switch (event.type) {
      case "message.appended":
        if (event.data.messageDelta) yield event.data.messageDelta;
        break;
      case "subagent.started":
        yield {
          type: "task_update",
          id: event.data.callId,
          title: event.data.subagentName,
          status: "in_progress",
        };
        break;
      case "subagent.completed":
        if (!event.data.backgroundTask) {
          yield {
            type: "task_update",
            id: event.data.callId,
            title: event.data.subagentName,
            status: "complete",
            ...(event.data.output ? { output: event.data.output } : {}),
          };
        }
        break;
      default:
        break;
    }

    if (isCurrentTurnBoundaryEvent(event)) break;
  }
}

/** Renders one structured chunk as the text a plain-text-only channel would show. */
function chunkToText(chunk: StreamChunk): string {
  switch (chunk.type) {
    case "markdown_text":
      return chunk.text;
    case "task_update": {
      const detail = chunk.output ?? chunk.details;
      return `\n_${chunk.title}${detail ? `: ${detail}` : ""}_\n`;
    }
    case "plan_update":
      return `\n_${chunk.title}_\n`;
  }
}

/**
 * Flattens a `string | StreamChunk` stream to text, so a channel that cannot represent structured
 * chunks still receives the whole answer rather than a stream with its non-text parts silently
 * dropped. This is the graceful-degradation path the bot takes when structured streaming is off.
 */
export async function* degradeToText(
  stream: AsyncIterable<string | StreamChunk>,
): AsyncIterable<string> {
  for await (const chunk of stream) {
    yield typeof chunk === "string" ? chunk : chunkToText(chunk);
  }
}
