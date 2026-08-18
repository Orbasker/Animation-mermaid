import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createSlackAdapter } from "@chat-adapter/slack";
import type { StateAdapter } from "chat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAgentContextPackage } from "@/domain/agent-context";
import { currentArchitectureSnapshot } from "@/domain/fixtures";

import { createReviewChatBot, type ReviewChatBot } from "./bot";
import type { ReviewAgent } from "./eve-agent";

const SIGNING_SECRET = "test-signing-secret";
const BOT_USER_ID = "U0BOT";
const MENTION_TS = "1700000000.000100";

function samplePackage() {
  return buildAgentContextPackage({
    intent: "Move fan-out behind one gateway",
    snapshot: currentArchitectureSnapshot(),
  });
}

/** A Slack Web API stand-in: answers every method `ok:true` so streamed replies post without a real workspace. */
let stub: Server;
let apiUrl: string;

beforeAll(async () => {
  stub = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          ts: "1700000000.000200",
          channel: "C1",
          channel_id: "C1",
          message: {},
          user: {},
          messages: [],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  const port = typeof address === "object" && address ? address.port : 0;
  apiUrl = `http://127.0.0.1:${port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

function countingAgent(): ReviewAgent & { calls: number } {
  return {
    calls: 0,
    async ask({ sessionId }) {
      this.calls += 1;
      async function* one(): AsyncIterable<string> {
        yield "Here is the answer.";
      }
      return { sessionId: sessionId ?? "sess-1", stream: one() };
    },
  };
}

async function makeBot(
  state: StateAdapter,
  agent: ReviewAgent,
): Promise<{ chat: ReviewChatBot; shareId: string }> {
  const slack = createSlackAdapter({
    signingSecret: SIGNING_SECRET,
    botToken: "xoxb-test",
    botUserId: BOT_USER_ID,
    apiUrl,
    nativeStreaming: false,
  });
  const chat = createReviewChatBot({
    state,
    slack,
    agent,
    structuredStreaming: false,
  });
  const shareId = await chat.store.share(samplePackage());
  return { chat, shareId };
}

async function deliver(
  chat: ReviewChatBot,
  body: unknown,
  options: { badSignature?: boolean; retryNum?: number } = {},
): Promise<Response> {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = options.badSignature
    ? "v0=deadbeef"
    : `v0=${createHmac("sha256", SIGNING_SECRET).update(`v0:${timestamp}:${raw}`).digest("hex")}`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-slack-signature": signature,
    "x-slack-request-timestamp": timestamp,
  };
  if (options.retryNum) headers["x-slack-retry-num"] = String(options.retryNum);

  const pending: Promise<unknown>[] = [];
  const response = await chat.bot.webhooks.slack(
    new Request("http://localhost/api/slack/events", {
      method: "POST",
      body: raw,
      headers,
    }),
    {
      waitUntil: (task) => pending.push(Promise.resolve(task).catch(() => {})),
    },
  );
  await Promise.all(pending);
  return response;
}

function mentionEvent(shareId: string, eventId = "Ev-mention") {
  return {
    type: "event_callback",
    event_id: eventId,
    team_id: "T1",
    event: {
      type: "app_mention",
      channel: "C1",
      ts: MENTION_TS,
      user: "U1",
      username: "reviewer",
      text: `<@${BOT_USER_ID}> ${shareId} what does this design do?`,
    },
  };
}

function followUpEvent(eventId = "Ev-follow") {
  return {
    type: "event_callback",
    event_id: eventId,
    team_id: "T1",
    event: {
      type: "message",
      channel: "C1",
      ts: "1700000000.000300",
      thread_ts: MENTION_TS,
      user: "U1",
      username: "reviewer",
      text: "and which part is the bottleneck?",
    },
  };
}

describe("slack review webhook", () => {
  it("rejects a request with an invalid signature", async () => {
    const { chat, shareId } = await makeBot(
      createMemoryState(),
      countingAgent(),
    );
    const response = await deliver(chat, mentionEvent(shareId), {
      badSignature: true,
    });
    expect(response.status).toBe(401);
  });

  it("accepts a correctly signed url_verification challenge", async () => {
    const { chat } = await makeBot(createMemoryState(), countingAgent());
    const response = await deliver(chat, {
      type: "url_verification",
      challenge: "chal-123",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "chal-123" });
  });

  it("subscribes the thread and answers once on a mention that names a shared package", async () => {
    const state = createMemoryState();
    const agent = countingAgent();
    const { chat, shareId } = await makeBot(state, agent);

    await deliver(chat, mentionEvent(shareId));

    expect(state._getSubscriptionCount()).toBe(1);
    expect(agent.calls).toBe(1);
  });

  it("produces no duplicate answer when an identical signed webhook is replayed", async () => {
    const state = createMemoryState();
    const agent = countingAgent();
    const { chat, shareId } = await makeBot(state, agent);
    const event = mentionEvent(shareId);

    await deliver(chat, event);
    await deliver(chat, event);

    expect(agent.calls).toBe(1);
  });

  it("keeps thread state across a redeploy (a new bot over the same backend)", async () => {
    const state = createMemoryState();
    const first = countingAgent();
    const original = await makeBot(state, first);

    await deliver(original.chat, mentionEvent(original.shareId));
    expect(state._getSubscriptionCount()).toBe(1);

    // A fresh bot instance over the same durable backend — what a redeploy produces.
    const second = countingAgent();
    const redeployed = await makeBot(state, second);

    await deliver(redeployed.chat, followUpEvent());

    // The follow-up routed to the subscribed-thread handler, so the thread binding survived.
    expect(second.calls).toBe(1);
  });
});
