/**
 * Privacy-safe diagnostics for the recovery surfaces.
 *
 * A reviewer hitting an error should be able to copy something support can act on without
 * leaking secrets or the contents of their diagram. This builds a fixed-shape report from the
 * environment and the thrown error only: never project source, entity labels, or annotations.
 */

export interface DiagnosticsInput {
  /** A short label for where the failure surfaced, e.g. "editor" or "app". */
  readonly scope: string;
  /** The error a boundary caught, if any. */
  readonly error?: unknown;
  /** Optional non-identifying counts (node/scene totals), never contents. */
  readonly projectSummary?: ProjectSummary;
}

/** Non-identifying shape of the open project — counts only, never contents. */
export interface ProjectSummary {
  readonly snapshots: number;
  readonly nodes: number;
  readonly edges: number;
  readonly stories: number;
}

export interface Diagnostics {
  readonly scope: string;
  readonly capturedAt: string;
  readonly url: string;
  readonly online: boolean;
  readonly userAgent: string;
  readonly capabilities: BrowserCapabilities;
  readonly error?: {
    readonly name: string;
    readonly message: string;
    readonly digest?: string;
  };
  readonly projectSummary?: ProjectSummary;
}

export interface BrowserCapabilities {
  readonly indexedDB: boolean;
  readonly webWorker: boolean;
  readonly cryptoRandomUUID: boolean;
  readonly clipboard: boolean;
}

/** The subset of a caught error that is safe to surface: identity, not payload. */
function describeError(error: unknown): Diagnostics["error"] {
  if (!error) return undefined;
  if (error instanceof Error) {
    const digest = (error as { digest?: unknown }).digest;
    return {
      name: error.name,
      message: error.message,
      ...(typeof digest === "string" ? { digest } : {}),
    };
  }
  return { name: "Error", message: String(error) };
}

/** Probes the browser features the editor depends on, tolerating a non-browser environment. */
export function detectCapabilities(): BrowserCapabilities {
  const hasWindow = typeof window !== "undefined";
  return {
    indexedDB: hasWindow && typeof window.indexedDB !== "undefined",
    webWorker: typeof Worker !== "undefined",
    cryptoRandomUUID:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function",
    clipboard:
      hasWindow &&
      typeof navigator !== "undefined" &&
      typeof navigator.clipboard?.writeText === "function",
  };
}

function currentUrl(): string {
  if (typeof window === "undefined") return "";
  // Path only — query strings can carry identifiers we should not copy around.
  return window.location.pathname;
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function buildDiagnostics(input: DiagnosticsInput): Diagnostics {
  return {
    scope: input.scope,
    capturedAt: new Date().toISOString(),
    url: currentUrl(),
    online: isOnline(),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    capabilities: detectCapabilities(),
    ...(input.error ? { error: describeError(input.error) } : {}),
    ...(input.projectSummary ? { projectSummary: input.projectSummary } : {}),
  };
}

export function formatDiagnostics(diagnostics: Diagnostics): string {
  return JSON.stringify(diagnostics, null, 2);
}

/**
 * Copies text using the async clipboard API, falling back to a hidden textarea + execCommand for
 * browsers or permission states where the async API is unavailable. Resolves to whether the copy
 * was accepted.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "absolute";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.("copy") ?? false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
