import type { ClientObservabilityEvent } from "@/observability/events";

const endpoint = "/api/observability";
const tokenSelector = 'meta[name="observability-token"]';
let reporting = false;

function trySendBeacon(body: string): boolean {
  try {
    return navigator.sendBeacon?.(endpoint, body) === true;
  } catch {
    return false;
  }
}

function tryFetch(body: string): void {
  try {
    void fetch(endpoint, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    return;
  }
}

export function reportClientObservabilityEvent(
  event: ClientObservabilityEvent,
): void {
  if (reporting) return;
  reporting = true;
  try {
    const token =
      document.querySelector<HTMLMetaElement>(tokenSelector)?.content;
    if (!token) return;

    const body = JSON.stringify({ token, event });
    if (trySendBeacon(body)) return;
    tryFetch(body);
  } catch {
    return;
  } finally {
    reporting = false;
  }
}
