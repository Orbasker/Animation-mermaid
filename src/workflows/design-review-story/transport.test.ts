import { afterEach, describe, expect, it } from "vitest";

import { resolveAgentTransport } from "./transport";

const ENV_KEYS = [
  "DESIGN_REVIEW_STORY_AGENT",
  "DESIGN_REVIEW_STORY_AGENT_SCRIPT",
  "VERCEL_ENV",
] as const;

const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function fixtureMode(script?: object) {
  process.env.DESIGN_REVIEW_STORY_AGENT = "fixture";
  if (script) process.env.DESIGN_REVIEW_STORY_AGENT_SCRIPT = JSON.stringify(script);
  else delete process.env.DESIGN_REVIEW_STORY_AGENT_SCRIPT;
  return resolveAgentTransport();
}

describe("resolveAgentTransport", () => {
  it("refuses the fixture agent in production", () => {
    process.env.VERCEL_ENV = "production";

    expect(() => fixtureMode()).toThrowError(/not allowed in production/);
  });

  it("allows the fixture agent outside production", () => {
    process.env.VERCEL_ENV = "preview";

    expect(() => fixtureMode()).not.toThrow();
  });

  it("reports an unparseable script instead of silently ignoring it", () => {
    process.env.DESIGN_REVIEW_STORY_AGENT = "fixture";
    process.env.DESIGN_REVIEW_STORY_AGENT_SCRIPT = "{not json";

    expect(() => resolveAgentTransport()).toThrowError(/not valid JSON/);
  });
});

describe("the fixture agent", () => {
  const prompt = "Every id you name must be one of: client, api, service.";

  it("answers only with entity ids the prompt allows", async () => {
    const transport = fixtureMode();
    const reply = await transport.turn({
      sessionId: "s1",
      attempt: 1,
      phase: "scenes",
      prompt,
      outputSchema: {},
    });

    const targets = (reply.data as { scenes: { actions: { target: string }[] }[] }).scenes
      .flatMap((scene) => scene.actions)
      .map((action) => action.target);

    expect(new Set(targets)).toEqual(new Set(["client", "api", "service"]));
  });

  it("fails the scripted number of leading attempts, then succeeds", async () => {
    const transport = fixtureMode({ failures: { scenes: 2 } });
    const turn = (attempt: number) =>
      transport.turn({ sessionId: "s1", attempt, phase: "scenes", prompt, outputSchema: {} });

    await expect(turn(1)).rejects.toThrow();
    await expect(turn(2)).rejects.toThrow();
    await expect(turn(3)).resolves.toBeDefined();
  });

  it("keys failures off the attempt, so repeated first attempts behave identically", async () => {
    const transport = fixtureMode({ failures: { analyze: 1 } });
    const turn = () =>
      transport.turn({
        sessionId: undefined,
        attempt: 1,
        phase: "analyze",
        prompt: "Use only these entity ids: client, api.",
        outputSchema: {},
      });

    await expect(turn()).rejects.toThrow();
    await expect(turn()).rejects.toThrow();
  });

  it("fails with the scripted status so both retry branches can be driven", async () => {
    const transport = fixtureMode({ failures: { scenes: 1 }, failureStatus: 400 });

    await expect(
      transport.turn({ sessionId: "s", attempt: 1, phase: "scenes", prompt, outputSchema: {} }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("can emit a scene naming an entity outside the graph", async () => {
    const transport = fixtureMode({ unknownEntity: true, sceneCount: 1 });
    const reply = await transport.turn({
      sessionId: "s",
      attempt: 1,
      phase: "scenes",
      prompt,
      outputSchema: {},
    });

    const [scene] = (reply.data as { scenes: { actions: { target: string }[] }[] }).scenes;

    expect(scene.actions[0].target).toBe("entity-that-does-not-exist");
  });

  it("opens a session when none is supplied and keeps it otherwise", async () => {
    const transport = fixtureMode();
    const opened = await transport.turn({
      sessionId: undefined,
      attempt: 1,
      phase: "analyze",
      prompt: "Use only these entity ids: client.",
      outputSchema: {},
    });
    const continued = await transport.turn({
      sessionId: opened.sessionId,
      attempt: 1,
      phase: "critique",
      prompt: "review",
      outputSchema: {},
    });

    expect(opened.sessionId).toBeTruthy();
    expect(continued.sessionId).toBe(opened.sessionId);
  });
});
