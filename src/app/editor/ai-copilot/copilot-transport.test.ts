import { describe, expect, it } from "vitest";

import { classifyFailureMessage } from "./copilot-transport";

describe("classifyFailureMessage", () => {
  it("classifies a Gateway budget cap as a budget error", () => {
    const error = classifyFailureMessage(
      "The agent rejected the request with 402; retrying cannot help: budget exceeded",
    );
    expect(error.kind).toBe("budget");
    expect(error.nextAction).toMatch(/budget/i);
  });

  it("classifies a rate limit", () => {
    expect(classifyFailureMessage("The agent is rate limited.").kind).toBe("rate-limit");
    expect(classifyFailureMessage("Upstream returned 429.").kind).toBe("rate-limit");
  });

  it("classifies an upstream provider fault", () => {
    expect(classifyFailureMessage("The agent returned 503.").kind).toBe("provider");
  });

  it("classifies a context/schema validation failure", () => {
    expect(
      classifyFailureMessage("The agent context package is not valid: intent required").kind,
    ).toBe("validation");
    expect(
      classifyFailureMessage("The generated story failed 1 schema check(s) (unknown-entity-reference)")
        .kind,
    ).toBe("validation");
  });

  it("falls back to unknown for an unrecognized message", () => {
    expect(classifyFailureMessage("something odd happened").kind).toBe("unknown");
  });

  it("always provides an actionable next step", () => {
    for (const message of ["402 budget", "429", "503", "not valid", "???"]) {
      expect(classifyFailureMessage(message).nextAction.length).toBeGreaterThan(0);
    }
  });
});
