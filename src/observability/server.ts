import {
  createObservabilityRecord,
  type ClientObservabilityEvent,
  type ObservabilityFeature,
} from "@/observability/events";
import {
  deploymentIdentity,
  type DeploymentIdentity,
} from "@/observability/deployment";

type ServerObservabilityEvent = {
  readonly type: "server_error";
  readonly errorClass: string;
  readonly routerKind: string;
  readonly routePath: string;
  readonly routeType: string;
};

const serverRouteFeatures = new Map<string, ObservabilityFeature>([
  ["/", "site"],
  ["/editor", "editor"],
  ["/api/design-review-story", "design-review"],
  ["/api/design-review-story/[runId]", "design-review"],
  ["/api/design-review-story/[runId]/decision", "design-review"],
  ["/api/design-review-story/[runId]/progress", "design-review"],
  ["/api/design-review-story/[runId]/proposal", "design-review"],
  ["/api/observability", "observability"],
]);

export function featureForServerRoute(routePath: string): ObservabilityFeature {
  const publicRoute =
    routePath === "/page"
      ? "/"
      : routePath.endsWith("/page")
        ? routePath.slice(0, -"/page".length)
        : routePath.endsWith("/route")
          ? routePath.slice(0, -"/route".length)
          : routePath;
  return serverRouteFeatures.get(publicRoute) ?? "unmapped";
}

export function recordObservabilityEvent(
  event: ClientObservabilityEvent | ServerObservabilityEvent,
  knownDeployment?: DeploymentIdentity,
): boolean {
  const deployment = knownDeployment ?? deploymentIdentity();
  if (!deployment) return false;

  const isClientEvent =
    event.type === "client_error" || event.type === "web_vital";
  console.info(
    JSON.stringify(
      createObservabilityRecord(
        event,
        deployment,
        isClientEvent ? "editor" : featureForServerRoute(event.routePath),
        isClientEvent ? "anonymous-client" : "server",
      ),
    ),
  );
  return true;
}
