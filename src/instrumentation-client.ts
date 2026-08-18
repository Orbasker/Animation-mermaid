import { reportClientObservabilityEvent } from "@/observability/client";
import { createClientErrorEvent } from "@/observability/events";

window.addEventListener("error", (event) => {
  reportClientObservabilityEvent(createClientErrorEvent("window", event.error));
});

window.addEventListener("unhandledrejection", (event) => {
  reportClientObservabilityEvent(
    createClientErrorEvent("unhandled_rejection", event.reason),
  );
});
