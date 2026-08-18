import { importMermaidFlowchart } from "@/domain/mermaid/import";
import { layoutFlowchart } from "@/domain/mermaid/layout";
import {
  resolveJobLimits,
  type ImportLayoutRequest,
  type ImportLayoutResult,
  type JobError,
  type JobErrorCode,
  type JobProgress,
} from "@/domain/mermaid/worker/protocol";

/** An error carrying a structured {@link JobError}, so both worker and inline paths agree. */
export class JobFailure extends Error {
  readonly error: JobError;

  constructor(error: JobError) {
    super(error.message);
    this.name = "JobFailure";
    this.error = error;
  }
}

function fail(
  code: JobErrorCode,
  message: string,
  diagnostics?: JobError["diagnostics"],
): never {
  throw new JobFailure(
    diagnostics ? { code, message, diagnostics } : { code, message },
  );
}

/** Options for a single job run, injected so the same runner serves worker and inline paths. */
export interface RunJobOptions {
  /** Called with bounded progress as the job advances. */
  readonly onProgress?: (progress: JobProgress) => void;
  /**
   * Cooperative cancellation. The job checks it between phases and races the (uninterruptible)
   * layout call against it, so an inline run can be abandoned even though ELK itself cannot be
   * torn down mid-flight. Abort with reason `"timeout"` to surface a `timeout` failure.
   */
  readonly signal?: AbortSignal;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason === "timeout") {
    fail("timeout", "The diagram took too long to import and lay out.");
  }
  fail("cancelled", "The import was cancelled.");
}

/** UTF-8 byte length of a string, matching the units {@link MermaidJobLimits.maxInputBytes} uses. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Parses, normalizes, and lays out a Mermaid flowchart, enforcing every configured limit and
 * reporting bounded progress. This is the single source of truth for the work; the Web Worker
 * wraps it, and the main-thread fallback calls it directly. It never mutates the source text
 * and always resolves to a snapshot whose `layout` is populated, or throws a {@link JobFailure}
 * carrying a structured {@link JobError}.
 *
 * Limits are checked cheapest-first: input size before parsing, node/edge counts before the
 * expensive layout, so a hostile diagram is rejected before it can cost anything.
 */
export async function runImportLayoutJob(
  request: ImportLayoutRequest,
  options: RunJobOptions = {},
): Promise<ImportLayoutResult> {
  const { onProgress, signal } = options;
  const limits = resolveJobLimits(request.limits);

  onProgress?.({ phase: "parse", ratio: 0, message: "Reading source…" });
  throwIfAborted(signal);

  const bytes = byteLength(request.text);
  if (bytes > limits.maxInputBytes) {
    fail(
      "input-too-large",
      `Source is ${bytes} bytes, over the ${limits.maxInputBytes}-byte limit.`,
    );
  }

  onProgress?.({ phase: "parse", ratio: 0.25, message: "Parsing diagram…" });
  const imported = importMermaidFlowchart({
    text: request.text,
    snapshotId: request.snapshotId,
    importedAt: request.importedAt,
  });

  if (!imported.snapshot) {
    const fatal = imported.diagnostics.find((d) => d.severity === "error");
    fail(
      "import-failed",
      fatal?.message ?? "The source is not a supported Mermaid flowchart.",
      imported.diagnostics,
    );
  }

  const snapshot = imported.snapshot;
  throwIfAborted(signal);

  onProgress?.({
    phase: "normalize",
    ratio: 0.5,
    message: "Normalizing graph…",
  });

  let nodeCount = 0;
  let edgeCount = 0;
  let groupCount = 0;
  for (const entity of snapshot.entities) {
    if (entity.kind === "node") nodeCount += 1;
    else if (entity.kind === "edge") edgeCount += 1;
    else groupCount += 1;
  }
  if (nodeCount > limits.maxNodes) {
    fail(
      "too-many-nodes",
      `Diagram has ${nodeCount} nodes, over the ${limits.maxNodes}-node limit.`,
    );
  }
  if (edgeCount > limits.maxEdges) {
    fail(
      "too-many-edges",
      `Diagram has ${edgeCount} edges, over the ${limits.maxEdges}-edge limit.`,
    );
  }

  throwIfAborted(signal);
  onProgress?.({
    phase: "layout",
    ratio: 0.75,
    message: "Laying out graph…",
  });

  let layout;
  try {
    layout = await raceAgainstSignal(
      layoutFlowchart(snapshot, {
        direction: request.direction ?? imported.direction,
        ...(request.nodeWidth !== undefined
          ? { nodeWidth: request.nodeWidth }
          : {}),
        ...(request.nodeHeight !== undefined
          ? { nodeHeight: request.nodeHeight }
          : {}),
      }),
      signal,
    );
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    fail(
      "layout-failed",
      error instanceof Error ? error.message : "Layout failed.",
    );
  }

  onProgress?.({ phase: "layout", ratio: 1, message: "Done." });

  return {
    snapshot: { ...snapshot, layout },
    diagnostics: imported.diagnostics,
    direction: imported.direction,
    stats: { nodeCount, edgeCount, groupCount },
  };
}

/**
 * Resolves `work`, but rejects with the abort reason if `signal` fires first. Layout cannot be
 * interrupted once started, so this lets an inline caller stop *waiting* on a superseded or
 * timed-out job even while ELK finishes in the background and its result is discarded.
 */
function raceAgainstSignal<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason === "timeout"
        ? new JobFailure({
            code: "timeout",
            message: "The diagram took too long to import and lay out.",
          })
        : new JobFailure({
            code: "cancelled",
            message: "The import was cancelled.",
          }),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(
        signal.reason === "timeout"
          ? new JobFailure({
              code: "timeout",
              message: "The diagram took too long to import and lay out.",
            })
          : new JobFailure({
              code: "cancelled",
              message: "The import was cancelled.",
            }),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
