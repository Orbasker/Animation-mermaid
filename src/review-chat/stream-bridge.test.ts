import { describe, expect, it } from "vitest";
import type { MessageStreamEvent } from "eve/client";
import type { StreamChunk } from "chat";

import { AgentTurnFailedError, chunksFromEveEvents, degradeToText } from "./stream-bridge";

async function* eventsOf(...events: unknown[]): AsyncIterable<MessageStreamEvent> {
  for (const event of events) yield event as MessageStreamEvent;
}

function appended(delta: string): unknown {
  return {
    type: "message.appended",
    data: { messageDelta: delta, messageSoFar: delta, sequence: 1, stepIndex: 0, turnId: "t1" },
  };
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of stream) out.push(item);
  return out;
}

describe("chunksFromEveEvents", () => {
  it("yields assistant text deltas as strings", async () => {
    const chunks = await collect(
      chunksFromEveEvents(eventsOf(appended("Hello "), appended("world."))),
    );
    expect(chunks).toEqual(["Hello ", "world."]);
  });

  it("drops reasoning deltas — only conclusions reach the reviewer", async () => {
    const reasoning = {
      type: "reasoning.appended",
      data: { reasoningDelta: "thinking", reasoningSoFar: "thinking", sequence: 1, stepIndex: 0, turnId: "t1" },
    };
    const chunks = await collect(chunksFromEveEvents(eventsOf(reasoning, appended("Answer."))));
    expect(chunks).toEqual(["Answer."]);
  });

  it("surfaces subagent activity as task_update chunks", async () => {
    const chunks = await collect(
      chunksFromEveEvents(
        eventsOf(
          { type: "subagent.started", data: { callId: "c1", subagentName: "lookup" } },
          appended("done "),
          { type: "subagent.completed", data: { callId: "c1", subagentName: "lookup", output: "ok" } },
        ),
      ),
    );
    expect(chunks[0]).toMatchObject({ type: "task_update", id: "c1", status: "in_progress" });
    expect(chunks[1]).toBe("done ");
    expect(chunks[2]).toMatchObject({ type: "task_update", id: "c1", status: "complete", output: "ok" });
  });

  it("throws a turn-failure into an AgentTurnFailedError", async () => {
    const failing = chunksFromEveEvents(
      eventsOf(appended("partial "), {
        type: "turn.failed",
        data: { code: "boom", message: "the model failed", sequence: 2, turnId: "t1" },
      }),
    );
    await expect(collect(failing)).rejects.toBeInstanceOf(AgentTurnFailedError);
  });
});

describe("degradeToText", () => {
  it("flattens structured chunks to text so nothing is silently dropped", async () => {
    async function* mixed(): AsyncIterable<string | StreamChunk> {
      yield "Here is the plan. ";
      yield { type: "task_update", id: "c1", title: "Searching", status: "complete", output: "found 3" };
      yield "Done.";
    }
    const text = (await collect(degradeToText(mixed()))).join("");
    expect(text).toContain("Here is the plan.");
    expect(text).toContain("Searching");
    expect(text).toContain("found 3");
    expect(text).toContain("Done.");
  });

  it("passes plain-text streams through unchanged", async () => {
    async function* textOnly(): AsyncIterable<string | StreamChunk> {
      yield "a";
      yield "b";
    }
    expect((await collect(degradeToText(textOnly()))).join("")).toBe("ab");
  });
});
