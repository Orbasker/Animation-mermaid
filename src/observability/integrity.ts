import { createHmac, timingSafeEqual } from "node:crypto";

import type { DeploymentIdentity } from "@/observability/deployment";

const TOKEN_VERSION = "v1";
const DEVELOPMENT_SECRET = "animation-mermaid-local-telemetry-key";

function signingSecret(environment: string): string | null {
  const configured = process.env.OBSERVABILITY_INGEST_SECRET;
  if (configured && configured.length >= 32) return configured;
  return environment === "production" ? null : DEVELOPMENT_SECRET;
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function issueTelemetryToken(
  deployment: DeploymentIdentity,
): string | null {
  const secret = signingSecret(deployment.environment);
  if (!secret) return null;

  const payload = Buffer.from(
    JSON.stringify({ release: deployment.release }),
  ).toString("base64url");
  const signedValue = `${TOKEN_VERSION}.${payload}`;
  return `${signedValue}.${signature(signedValue, secret).toString("base64url")}`;
}

export function verifyTelemetryToken(
  token: string,
  deployment: DeploymentIdentity,
): boolean {
  const secret = signingSecret(deployment.environment);
  if (!secret) return false;

  const [version, payload, encodedSignature, extra] = token.split(".");
  if (
    version !== TOKEN_VERSION ||
    !payload ||
    !encodedSignature ||
    extra !== undefined
  ) {
    return false;
  }

  let release: unknown;
  let actualSignature: Buffer;
  try {
    release = JSON.parse(Buffer.from(payload, "base64url").toString()).release;
    actualSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return false;
  }

  const expectedSignature = signature(`${version}.${payload}`, secret);
  return (
    release === deployment.release &&
    actualSignature.length === expectedSignature.length &&
    timingSafeEqual(actualSignature, expectedSignature)
  );
}
