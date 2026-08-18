import type { GraphSnapshot, SnapshotId } from "@/domain/graph";
import type { Direction, MermaidDiagnostic } from "@/domain/mermaid/types";

/**
 * Configurable ceilings applied to a single import+layout job. They bound the work a hostile
 * or accidental diagram can force onto the CPU: the raw source size, the graph size ELK is
 * asked to lay out, and the wall-clock the whole job may run. Every limit has a conservative
 * default; callers may tighten (or, for trusted paths, loosen) any subset.
 */
export interface MermaidJobLimits {
  /** Maximum UTF-8 size of the source text, in bytes. */
  readonly maxInputBytes: number;
  /** Maximum number of node entities the imported graph may contain. */
  readonly maxNodes: number;
  /** Maximum number of edge entities the imported graph may contain. */
  readonly maxEdges: number;
  /** Maximum wall-clock the whole job (parse + normalize + layout) may run, in ms. */
  readonly timeoutMs: number;
}

/**
 * Defaults sized for the design-review workspace: a quarter-megabyte of source, a few
 * thousand nodes/edges, and a ten-second ceiling. These comfortably clear the shipped stress
 * fixtures while still stopping a pathological diagram from pinning a core indefinitely.
 */
export const DEFAULT_JOB_LIMITS: MermaidJobLimits = {
  maxInputBytes: 256 * 1024,
  maxNodes: 2_000,
  maxEdges: 4_000,
  timeoutMs: 10_000,
};

/** Merges a partial override onto the defaults, yielding a fully-populated limit set. */
export function resolveJobLimits(
  overrides?: Partial<MermaidJobLimits>,
): MermaidJobLimits {
  return { ...DEFAULT_JOB_LIMITS, ...overrides };
}

/** The ordered phases a job moves through; used to label bounded progress. */
export type JobPhase = "parse" | "normalize" | "layout";

/**
 * A single import+layout request. `text`, `snapshotId`, and `importedAt` mirror
 * {@link ImportMermaidInput} so the produced snapshot is deterministic; `direction` and the
 * node dimensions feed {@link layoutFlowchart}. `limits` overrides a subset of the defaults.
 */
export interface ImportLayoutRequest {
  readonly text: string;
  readonly snapshotId: SnapshotId;
  readonly importedAt: string;
  readonly direction?: Direction;
  readonly nodeWidth?: number;
  readonly nodeHeight?: number;
  readonly limits?: Partial<MermaidJobLimits>;
}

/** Bounded progress for a running job. `ratio` is always within `[0, 1]`. */
export interface JobProgress {
  readonly phase: JobPhase;
  readonly ratio: number;
  readonly message: string;
}

/** The counts an import produced, reported alongside a successful result. */
export interface JobStats {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly groupCount: number;
}

/**
 * A successful import+layout: the laid-out snapshot (source untouched, `layout` populated),
 * every diagnostic the importer gathered, the resolved direction, and the graph's size.
 */
export interface ImportLayoutResult {
  readonly snapshot: GraphSnapshot;
  readonly diagnostics: readonly MermaidDiagnostic[];
  readonly direction: Direction;
  readonly stats: JobStats;
}

/** Machine-readable reason a job failed, so callers can react without string-matching. */
export type JobErrorCode =
  | "input-too-large"
  | "too-many-nodes"
  | "too-many-edges"
  | "timeout"
  | "import-failed"
  | "layout-failed"
  | "worker-error"
  | "cancelled";

/**
 * A structured job failure. `diagnostics` is present for `import-failed` so the caller can
 * surface the exact fatal parser diagnostics. A failure never carries a snapshot — the caller
 * keeps whatever graph it already had, and always keeps the source text.
 */
export interface JobError {
  readonly code: JobErrorCode;
  readonly message: string;
  readonly diagnostics?: readonly MermaidDiagnostic[];
}

/** Whether a failure should be treated as a user-visible error or a silent cancellation. */
export function isCancellation(error: JobError): boolean {
  return error.code === "cancelled";
}

/** Messages the main thread posts into the worker. */
export type WorkerInboundMessage = {
  readonly kind: "run";
  readonly requestId: number;
  readonly request: ImportLayoutRequest;
};

/**
 * Messages the worker posts back. Every message carries the `requestId` it belongs to so the
 * controller can drop anything that does not match the request currently in flight — the
 * defensive half of stale-result suppression.
 */
export type WorkerOutboundMessage =
  | {
      readonly kind: "progress";
      readonly requestId: number;
      readonly progress: JobProgress;
    }
  | {
      readonly kind: "result";
      readonly requestId: number;
      readonly result: ImportLayoutResult;
    }
  | {
      readonly kind: "error";
      readonly requestId: number;
      readonly error: JobError;
    };
