import type { GraphSnapshot } from "@/domain/graph";

/** Flow direction declared by a flowchart header (`flowchart TD`, `graph LR`, …). */
export type Direction = "TD" | "TB" | "BT" | "LR" | "RL";

/** The set of directions this importer understands. */
export const DIRECTIONS: readonly Direction[] = ["TD", "TB", "BT", "LR", "RL"];

/** Default direction when a header omits one (`flowchart`). */
export const DEFAULT_DIRECTION: Direction = "TD";

/**
 * Renderer-neutral shape carried from a node's Mermaid syntax. `"rectangle"` is the default
 * and is never emitted as an attribute; every other shape is recorded on the node so a
 * renderer can reproduce it without re-reading the source.
 */
export type NodeShape =
  | "rectangle"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "diamond"
  | "hexagon"
  | "parallelogram"
  | "parallelogram-alt"
  | "trapezoid"
  | "trapezoid-alt"
  | "asymmetric";

/** Line style of an edge. `"solid"` is the default and is never emitted as an attribute. */
export type EdgeLineStyle = "solid" | "dotted" | "thick";

/** Arrowhead style of an edge. `"normal"` is the default and is never emitted as an attribute. */
export type EdgeArrow = "normal" | "open" | "cross" | "circle";

/** Severity of a diagnostic produced while importing. */
export type DiagnosticSeverity = "error" | "warning" | "info";

export type MermaidDiagnosticCode =
  | "empty-source"
  | "not-a-flowchart"
  | "unclosed-subgraph"
  | "unexpected-end"
  | "directive-ignored"
  | "styling-ignored"
  | "interaction-ignored"
  | "unsupported-ampersand"
  | "unrecognized-statement"
  | "empty-node-id"
  | "label-sanitized";

/**
 * A single problem found while importing, anchored to a source location so the caller can
 * point the user at the exact line (and, when known, column) that produced it. `error`
 * severity means no snapshot was produced; `warning`/`info` mean the construct was skipped
 * or sanitized but the rest of the diagram imported.
 */
export interface MermaidDiagnostic {
  readonly code: MermaidDiagnosticCode;
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
 * The result of importing a Mermaid flowchart: the normalized {@link GraphSnapshot} (or
 * `null` when a fatal diagnostic prevented one), every diagnostic gathered along the way,
 * and the parsed {@link Direction} so a caller can feed a matching layout. `ok` is a
 * convenience: true iff no `error`-severity diagnostic was produced.
 */
export interface MermaidImportResult {
  readonly ok: boolean;
  readonly snapshot: GraphSnapshot | null;
  readonly diagnostics: readonly MermaidDiagnostic[];
  readonly direction: Direction;
}
