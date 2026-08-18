import { createMemoryState } from "@chat-adapter/state-memory";
import { describe, expect, it } from "vitest";
import type { StreamChunk } from "chat";

import { buildAgentContextPackage } from "@/domain/agent-context";
import { currentArchitectureSnapshot } from "@/domain/fixtures";
import type { ValidatedAgentContext } from "@/workflows/design-review-story/contract";

import { createFixtureReviewAgent } from "./fixture-agent";
import type { ReviewAgent } from "./eve-agent";
import {
  handleFollowUp,
  handleMention,
  type ReviewHandlerDeps,
  type ReviewThread,
  type ReviewThreadState,
} from "./handlers";
import { createStateBackedShareStore } from "./share-store";
import { AgentTurnFailedError } from "./stream-bridge";

interface PostedText {
  readonly text: string;
}

/** A ReviewThread that records everything the handler does, without any platform behind it. */
class FakeThread implements ReviewThread {
  readonly id = "slack:C1:t1";
  subscribed = false;
  typed = 0;
  private stateValue: ReviewThreadState | null;
  readonly posts: PostedText[] = [];

  constructor(initial: ReviewThreadState | null = null) {
    this.stateValue = initial;
  }

  async subscribe(): Promise<void> {
    this.subscribed = true;
  }

  async startTyping(): Promise<void> {
    this.typed += 1;
  }

  get state(): Promise<ReviewThreadState | null> {
    return Promise.resolve(this.stateValue);
  }

  async setState(state: ReviewThreadState): Promise<void> {
    this.stateValue = state;
  }

  async post(
    message: string | AsyncIterable<string | StreamChunk>,
  ): Promise<unknown> {
    if (typeof message === "string") {
      this.posts.push({ text: message });
      return undefined;
    }
    let text = "";
    for await (const chunk of message) {
      text += typeof chunk === "string" ? chunk : JSON.stringify(chunk);
    }
    this.posts.push({ text });
    return undefined;
  }

  get lastPost(): string {
    return this.posts.at(-1)?.text ?? "";
  }
}

function samplePackage(): ValidatedAgentContext {
  return buildAgentContextPackage({
    intent: "Move fan-out behind one gateway",
    snapshot: currentArchitectureSnapshot(),
  });
}

async function depsWithShare(
  agent: ReviewAgent = createFixtureReviewAgent(),
): Promise<{
  deps: ReviewHandlerDeps;
  shareId: string;
  pkg: ValidatedAgentContext;
}> {
  const state = createMemoryState();
  const store = createStateBackedShareStore(state);
  const pkg = samplePackage();
  const shareId = await store.share(pkg);
  return { deps: { store, agent, structuredStreaming: true }, shareId, pkg };
}

describe("handleMention", () => {
  it("subscribes and answers when the mention names a shared package", async () => {
    const { deps, shareId } = await depsWithShare();
    const thread = new FakeThread();

    await handleMention(
      thread,
      `<@U0BOT> ${shareId} what does this design do?`,
      deps,
    );

    expect(thread.subscribed).toBe(true);
    expect((await thread.state)?.shareId).toBe(shareId);
    expect(thread.lastPost).toContain("shared review package");
  });

  it("does not subscribe and rejects a mention with no share reference", async () => {
    const { deps } = await depsWithShare();
    const thread = new FakeThread();

    await handleMention(thread, "<@U0BOT> hey can you help?", deps);

    expect(thread.subscribed).toBe(false);
    expect(thread.posts).toHaveLength(1);
    expect(thread.lastPost).toMatch(/shared review link or code/i);
  });

  it("rejects a mention naming a package that was never shared", async () => {
    const { deps } = await depsWithShare();
    const thread = new FakeThread();

    await handleMention(
      thread,
      `<@U0BOT> ${`rev_${"f".repeat(32)}`} explain this`,
      deps,
    );

    expect(thread.subscribed).toBe(false);
    expect(thread.lastPost).toMatch(/couldn't find a shared review package/i);
  });
});

describe("handleFollowUp", () => {
  it("answers from the shared package that the thread is bound to", async () => {
    const { deps, shareId, pkg } = await depsWithShare();
    const thread = new FakeThread({ shareId });

    await handleFollowUp(thread, "which component is central here?", deps);

    // The fixture answer is derived only from the shared package's own content.
    expect(thread.lastPost).toContain(pkg.intent);
    expect(thread.typed).toBe(1);
  });

  it("ignores a message in a thread bound to nothing", async () => {
    const { deps } = await depsWithShare();
    const thread = new FakeThread(null);

    await handleFollowUp(thread, "anyone home?", deps);

    expect(thread.posts).toHaveLength(0);
  });

  it("reports when the bound package is no longer shared", async () => {
    const { deps } = await depsWithShare();
    const thread = new FakeThread({ shareId: `rev_${"e".repeat(32)}` });

    await handleFollowUp(thread, "still there?", deps);

    expect(thread.lastPost).toMatch(/no longer available/i);
  });

  it("threads one eve session across follow-ups", async () => {
    const asks: (string | undefined)[] = [];
    const agent: ReviewAgent = {
      async ask({ sessionId, question }) {
        asks.push(sessionId);
        async function* one(): AsyncIterable<string> {
          yield `answer to: ${question}`;
        }
        return { sessionId: sessionId ?? "sess-1", stream: one() };
      },
    };
    const { deps, shareId } = await depsWithShare(agent);
    const thread = new FakeThread({ shareId });

    await handleFollowUp(thread, "first?", deps);
    await handleFollowUp(thread, "second?", deps);

    expect(asks[0]).toBeUndefined();
    expect(asks[1]).toBe("sess-1");
    expect((await thread.state)?.sessionId).toBe("sess-1");
  });
});

describe("streaming degradation", () => {
  const structuredAgent: ReviewAgent = {
    async ask() {
      async function* mixed(): AsyncIterable<string | StreamChunk> {
        yield "Looking. ";
        yield {
          type: "task_update",
          id: "c1",
          title: "Inspecting gateway",
          status: "complete",
        };
        yield "It routes fan-out.";
      }
      return { sessionId: "s", stream: mixed() };
    },
  };

  it("flattens structured chunks to text when structured streaming is off", async () => {
    const { deps: base, shareId } = await depsWithShare(structuredAgent);
    const deps: ReviewHandlerDeps = { ...base, structuredStreaming: false };
    const thread = new FakeThread({ shareId });

    await handleFollowUp(thread, "how does it route?", deps);

    expect(thread.lastPost).toContain("Looking.");
    expect(thread.lastPost).toContain("Inspecting gateway");
    expect(thread.lastPost).toContain("It routes fan-out.");
    expect(thread.lastPost).not.toContain("task_update");
  });
});

describe("agent failure", () => {
  it("turns a failed turn into a visible reply rather than a dropped stream", async () => {
    const failingAgent: ReviewAgent = {
      async ask() {
        async function* boom(): AsyncIterable<string> {
          yield "starting ";
          throw new AgentTurnFailedError("the model failed");
        }
        return { sessionId: "s", stream: boom() };
      },
    };
    const { deps, shareId } = await depsWithShare(failingAgent);
    const thread = new FakeThread({ shareId });

    await handleFollowUp(thread, "explain", deps);

    expect(thread.lastPost).toMatch(/couldn't answer that: the model failed/i);
  });
});
