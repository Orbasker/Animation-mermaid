import { FatalError, RetryableError } from "workflow";
import { describe, expect, it } from "vitest";

import { classifyAgentError } from "./agent";

function classify(error: unknown): Error {
  try {
    classifyAgentError(error);
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error("classifyAgentError must always throw");
}

describe("classifyAgentError", () => {
  it("retries a rate limit, with a delay", () => {
    const error = classify({ status: 429 });

    expect(error).toBeInstanceOf(RetryableError);
  });

  it("retries an upstream server error", () => {
    expect(classify({ status: 500 })).toBeInstanceOf(RetryableError);
    expect(classify({ status: 503 })).toBeInstanceOf(RetryableError);
  });

  it("retries a timeout", () => {
    expect(classify({ status: 408 })).toBeInstanceOf(RetryableError);
  });

  it("retries a network fault, which carries no status", () => {
    expect(classify(new TypeError("fetch failed"))).toBeInstanceOf(
      RetryableError,
    );
  });

  it("does not retry a rejected request", () => {
    expect(classify({ status: 400, body: "bad schema" })).toBeInstanceOf(
      FatalError,
    );
    expect(classify({ status: 401 })).toBeInstanceOf(FatalError);
    expect(classify({ status: 404 })).toBeInstanceOf(FatalError);
  });

  it("passes an already-classified error through unchanged", () => {
    const fatal = new FatalError("nope");
    const retryable = new RetryableError("later");

    expect(classify(fatal)).toBe(fatal);
    expect(classify(retryable)).toBe(retryable);
  });
});
