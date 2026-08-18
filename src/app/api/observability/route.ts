import { recordObservabilityEvent } from "@/observability/server";
import { deploymentIdentity } from "@/observability/deployment";
import { verifyTelemetryToken } from "@/observability/integrity";
import { clientObservabilityEnvelopeSchema } from "@/observability/schema";

const MAX_EVENT_BYTES = 2_048;

function isSameOriginBrowserRequest(request: Request): boolean {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const mode = request.headers.get("sec-fetch-mode");
  const destination = request.headers.get("sec-fetch-dest");
  return (
    origin === expectedOrigin &&
    site === "same-origin" &&
    (mode === "cors" || mode === "no-cors") &&
    (destination === "empty" || destination === null)
  );
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EVENT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return new Uint8Array();
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return new Response(null, { status: 403 });
  }

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (
    !Number.isFinite(declaredSize) ||
    declaredSize < 0 ||
    declaredSize > MAX_EVENT_BYTES
  ) {
    return new Response(null, { status: 413 });
  }

  const bytes = await readBoundedBody(request);
  if (!bytes) return new Response(null, { status: 413 });

  let candidate: unknown;
  try {
    candidate = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return new Response(null, { status: 400 });
  }

  const envelope = clientObservabilityEnvelopeSchema.safeParse(candidate);
  if (!envelope.success) return new Response(null, { status: 400 });

  const deployment = deploymentIdentity();
  if (!deployment) return new Response(null, { status: 503 });
  if (!verifyTelemetryToken(envelope.data.token, deployment)) {
    return new Response(null, { status: 401 });
  }

  recordObservabilityEvent(envelope.data.event, deployment);
  return new Response(null, { status: 204 });
}
