import type { GraphSnapshot, LayoutHint, SnapshotId } from "@/domain/graph";

/** Severity of a diagnostic produced while importing a diagram. */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A single problem found while importing, anchored to a source location so a caller can point
 * the user at the exact line (and, when known, column) that produced it. `error` severity
 * means no snapshot was produced; `warning`/`info` mean the construct was skipped or sanitized
 * but the rest of the diagram imported. `code` is importer-defined so each grammar can carry
 * its own vocabulary while sharing this shape.
 */
export interface ImportDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** 1-based line the problem is anchored to. */
  readonly line: number;
  /** 1-based column, when it can be determined. */
  readonly column?: number;
  /** The offending source text, trimmed, for display alongside the message. */
  readonly snippet?: string;
}

/** How completely an importer handles one named construct of its grammar. */
export type FeatureSupport = "full" | "partial" | "none";

/**
 * A single line in an importer's capability report: a named construct of the grammar and how
 * completely this importer handles it. Surfaced in the UI so a user knows, before pasting,
 * what will survive the import and what will be dropped or flagged.
 */
export interface ImporterFeature {
  /** Human-facing construct name, e.g. "Participants", "Node shapes". */
  readonly name: string;
  readonly support: FeatureSupport;
  /** Optional one-line clarification of the support level. */
  readonly detail?: string;
}

/**
 * A machine- and human-readable description of what an importer is and does. `importer` and
 * `importerVersion` match the {@link ImporterMetadata} recorded in a snapshot's provenance, so
 * a stored project can always be traced back to the importer (and capability set) that
 * produced it.
 */
export interface ImporterCapabilities {
  /** Stable identifier recorded in snapshot provenance, e.g. "mermaid-sequence". */
  readonly importer: string;
  /** Version of the importer, bumped when its output shape changes. */
  readonly importerVersion: string;
  /** Human-facing name, e.g. "Mermaid Sequence Diagram". */
  readonly label: string;
  /** The `diagramType` this importer writes onto a snapshot's source, e.g. "sequenceDiagram". */
  readonly diagramType: string;
  /** The family of grammar, e.g. "mermaid". */
  readonly grammar: string;
  /** One-line description shown alongside the capability report. */
  readonly summary: string;
  /** The named constructs this importer supports, for capability reporting. */
  readonly features: readonly ImporterFeature[];
}

/** Input to any importer: raw source, the id to assign the snapshot, and a deterministic timestamp. */
export interface DiagramImportInput {
  /** Raw diagram source, preserved byte-for-byte in the snapshot. */
  readonly text: string;
  /** Id to assign the produced snapshot. */
  readonly snapshotId: SnapshotId;
  /** ISO-8601 timestamp for the import, supplied by the caller for determinism. */
  readonly importedAt: string;
}

/**
 * The importer-neutral result of importing a diagram: the normalized {@link GraphSnapshot} (or
 * `null` when a fatal diagnostic prevented one), every diagnostic gathered along the way, and
 * the {@link ImporterCapabilities} of whichever importer ran (`null` only when no importer
 * recognized the source). `ok` is a convenience: true iff no `error`-severity diagnostic was
 * produced.
 */
export interface DiagramImportResult {
  readonly ok: boolean;
  readonly snapshot: GraphSnapshot | null;
  readonly diagnostics: readonly ImportDiagnostic[];
  readonly capabilities: ImporterCapabilities | null;
}

/**
 * The plugin contract every diagram grammar implements. An importer recognizes its own source
 * ({@link detect}), normalizes it into a {@link GraphSnapshot} through the shared graph
 * boundary ({@link import}), and lays that snapshot out deterministically ({@link layout}).
 * Everything downstream — stories, comparison, the agent context — consumes only the resulting
 * snapshot, so adding an importer never touches the story engine.
 */
export interface DiagramImporter {
  readonly capabilities: ImporterCapabilities;
  /**
   * Whether this importer recognizes the source as its own grammar. Detection reads only the
   * diagram header, never the whole document, so it is cheap and side-effect free.
   */
  detect(text: string): boolean;
  /** Normalizes recognized source into a snapshot, gathering diagnostics rather than throwing. */
  import(input: DiagramImportInput): DiagramImportResult;
  /** Deterministic renderer-neutral layout for a snapshot this importer produced. */
  layout(snapshot: GraphSnapshot): Promise<readonly LayoutHint[]>;
}
