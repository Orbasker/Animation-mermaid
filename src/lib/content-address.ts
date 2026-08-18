import { createHash } from "node:crypto";

/**
 * Stable stringification for content addressing: object keys are emitted in sorted order, so
 * two structurally equal values always hash to the same digest regardless of the key order the
 * producer happened to use. `undefined` members are dropped so an absent optional and an
 * explicit `undefined` address identically.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 hex digest of a value's canonical form. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
