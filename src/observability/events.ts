import type { DeploymentIdentity } from "@/observability/deployment";

export type ErrorClass =
  | "Error"
  | "TypeError"
  | "RangeError"
  | "ReferenceError"
  | "SyntaxError"
  | "URIError"
  | "AggregateError"
  | "NonError";

const knownErrorClasses = new Set<ErrorClass>([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "AggregateError",
]);

export type ClientObservabilityEvent =
  | {
      readonly type: "client_error";
      readonly source: "window" | "unhandled_rejection";
      readonly errorClass: ErrorClass;
    }
  | {
      readonly type: "web_vital";
      readonly name: "TTFB" | "FCP" | "LCP" | "FID" | "CLS" | "INP";
      readonly value: number;
      readonly delta: number;
      readonly rating: "good" | "needs-improvement" | "poor";
      readonly navigationType:
        | "navigate"
        | "reload"
        | "prerender"
        | "back-forward"
        | "back-forward-cache"
        | "restore";
    };

type WebVitalEvent = Extract<
  ClientObservabilityEvent,
  { readonly type: "web_vital" }
>;

type WebVitalMetric = Omit<WebVitalEvent, "type" | "value" | "delta"> & {
  readonly value: number;
  readonly delta: number;
};

type ServerErrorContext = {
  readonly routerKind: "Pages Router" | "App Router";
  readonly routePath: string;
  readonly routeType: "render" | "route" | "action" | "proxy";
};

function classifyError(error: unknown): ErrorClass {
  if (!(error instanceof Error)) return "NonError";
  return knownErrorClasses.has(error.name as ErrorClass)
    ? (error.name as ErrorClass)
    : "Error";
}

export function createClientErrorEvent(
  source: "window" | "unhandled_rejection",
  error: unknown,
): ClientObservabilityEvent {
  return {
    type: "client_error",
    source,
    errorClass: classifyError(error),
  };
}

export function createWebVitalEvent(
  metric: WebVitalMetric,
): ClientObservabilityEvent {
  const precision = metric.name === "CLS" ? 1000 : 1;
  return {
    type: "web_vital",
    name: metric.name,
    value: Math.round(metric.value * precision) / precision,
    delta: Math.round(metric.delta * precision) / precision,
    rating: metric.rating,
    navigationType: metric.navigationType,
  };
}

export type ObservabilityFeature =
  "editor" | "design-review" | "observability" | "site" | "unmapped";

export type ObservabilityTrust = "anonymous-client" | "server";

export function createObservabilityRecord<T extends Record<string, unknown>>(
  event: T,
  deployment: DeploymentIdentity,
  feature: ObservabilityFeature,
  trust: ObservabilityTrust,
) {
  return {
    schemaVersion: 1 as const,
    feature,
    trust,
    release: deployment.release,
    environment: deployment.environment,
    ...event,
  };
}

export function createServerErrorEvent(
  error: unknown,
  context: ServerErrorContext,
) {
  return {
    type: "server_error" as const,
    errorClass: classifyError(error),
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
  };
}
