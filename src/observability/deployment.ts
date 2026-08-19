export type DeploymentIdentity = {
  readonly release: string;
  readonly environment: string;
};

export function deploymentIdentity(): DeploymentIdentity | null {
  const environment =
    process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  const release =
    process.env.OBSERVABILITY_RELEASE ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID;

  if (release) return { release, environment };
  if (environment === "production") return null;

  return { release: "local", environment };
}
