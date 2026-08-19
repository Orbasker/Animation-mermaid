import { afterEach, describe, expect, it } from "vitest";

import { deploymentIdentity } from "@/observability/deployment";

const originalEnvironment = process.env.VERCEL_ENV;
const originalNodeEnvironment = process.env.NODE_ENV;
const originalRelease = process.env.OBSERVABILITY_RELEASE;
const originalCommit = process.env.VERCEL_GIT_COMMIT_SHA;
const originalDeployment = process.env.VERCEL_DEPLOYMENT_ID;

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("VERCEL_ENV", originalEnvironment);
  restore("NODE_ENV", originalNodeEnvironment);
  restore("OBSERVABILITY_RELEASE", originalRelease);
  restore("VERCEL_GIT_COMMIT_SHA", originalCommit);
  restore("VERCEL_DEPLOYMENT_ID", originalDeployment);
});

describe("deployment identity", () => {
  it("never invents a local release in production", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.OBSERVABILITY_RELEASE;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_DEPLOYMENT_ID;

    expect(deploymentIdentity()).toBeNull();
  });

  it("allows an explicit local identity outside production", () => {
    process.env.VERCEL_ENV = "development";
    delete process.env.OBSERVABILITY_RELEASE;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_DEPLOYMENT_ID;

    expect(deploymentIdentity()).toEqual({
      release: "local",
      environment: "development",
    });
  });
});
