import type { GraphSnapshot } from "@/domain/graph";

/**
 * Layout direction carried from a DOT `rankdir` attribute. DOT's default is top-to-bottom;
 * the values mirror Graphviz's `TB`/`LR`/`BT`/`RL` and map straight onto the shared layout
 * {@link import("@/domain/mermaid/types").Direction}.
 */
export type GraphvizDirection = "TB" | "LR" | "BT" | "RL";

/** The set of `rankdir` values this importer understands. */
export const GRAPHVIZ_DIRECTIONS: readonly GraphvizDirection[] = [
  "TB",
  "LR",
  "BT",
  "RL",
];

/** Default direction when the source declares no `rankdir`. */
export const DEFAULT_GRAPHVIZ_DIRECTION: GraphvizDirection = "TB";

/** Severity of a diagnostic produced while importing. */
export type DiagnosticSeverity = "error" | "warning" | "info";

export type GraphvizDiagnosticCode =
  | "empty-source"
  | "not-a-graphviz"
  | "unclosed-brace"
  | "unexpected-close"
  | "label-sanitized"
  | "default-attributes-ignored"
  | "unsupported-endpoint"
  | "unsupported-html-id"
  | "port-ignored"
  | "empty-node-id"
  | "unrecognized-statement";

/**
 * A single problem found while importing, anchored to a source location so a caller can point
 * the user at the exact line (and, when known, column) that produced it. `error` severity means
 * no snapshot was produced; `warning`/`info` mean the construct was skipped or sanitized but the
 * rest of the diagram imported. Structurally compatible with the shared
 * {@link import("@/domain/import/contract").ImportDiagnostic}.
 */
export interface GraphvizDiagnostic {
  readonly code: GraphvizDiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** 1-based line the problem is anchored to. */
  readonly line: number;
  /** 1-based column, when it can be determined. */
  readonly column?: number;
  /** The offending source text, trimmed, for display alongside the message. */
  readonly snippet?: string;
}

/**
 * The result of importing a Graphviz DOT diagram: the normalized {@link GraphSnapshot} (or `null`
 * when a fatal diagnostic prevented one), every diagnostic gathered along the way, and the parsed
 * {@link GraphvizDirection} so a caller can feed a matching layout. `ok` is a convenience: true
 * iff no `error`-severity diagnostic was produced.
 */
export interface GraphvizImportResult {
  readonly ok: boolean;
  readonly snapshot: GraphSnapshot | null;
  readonly diagnostics: readonly GraphvizDiagnostic[];
  readonly direction: GraphvizDirection;
}
