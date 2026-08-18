/**
 * Feature slug that tags every Gateway call and telemetry span this agent
 * produces, so usage and traces can be filtered to the design-review agent.
 */
export const FEATURE = "design-review";

/**
 * Deployment environment for usage attribution. On Vercel, `VERCEL_ENV` is one
 * of `production`, `preview`, or `development`; off-platform we fall back to
 * `NODE_ENV` and finally `development`.
 */
export function resolveEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

/**
 * AI Gateway usage tags. `tags` attribute Gateway spend and traces by feature
 * and environment; `env`/`feature` are mirrored onto OTel spans so the same run
 * is identifiable in both surfaces.
 */
export function gatewayTags(): string[] {
  return [`feature:${FEATURE}`, `env:${resolveEnvironment()}`];
}
