import {
  snapshotId,
  type GraphSnapshot,
  type SnapshotId,
} from "@/domain/graph";
import { importMermaidFlowchart } from "@/domain/mermaid/import";
import { layoutFlowchart } from "@/domain/mermaid/layout";
import type {
  Direction,
  MermaidDiagnostic,
  MermaidImportResult,
} from "@/domain/mermaid/types";

/** A cheap, synchronous read of what a paste/upload would import — no layout is computed. */
export interface MermaidImportPreview {
  /** True iff no `error`-severity diagnostic was produced. */
  readonly ok: boolean;
  /** True when a fatal diagnostic (bad header / empty source) prevented parsing. */
  readonly fatal: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly groupCount: number;
  readonly diagnostics: readonly MermaidDiagnostic[];
  readonly direction: Direction;
}

const PREVIEW_SNAPSHOT_ID = snapshotId("import-preview");

/**
 * Parses `text` and reports counts and diagnostics without running layout, so the import
 * dialog can validate keystroke-by-keystroke. Empty input is reported as fatal but with no
 * diagnostics, so a blank editor reads as "nothing to import yet" rather than an error.
 */
export function previewMermaidImport(text: string): MermaidImportPreview {
  if (text.trim().length === 0) {
    return {
      ok: false,
      fatal: true,
      nodeCount: 0,
      edgeCount: 0,
      groupCount: 0,
      diagnostics: [],
      direction: "TD",
    };
  }
  const result = importMermaidFlowchart({
    text,
    snapshotId: PREVIEW_SNAPSHOT_ID,
    importedAt: "1970-01-01T00:00:00.000Z",
  });
  const entities = result.snapshot?.entities ?? [];
  return {
    ok: result.ok,
    fatal: result.snapshot === null,
    nodeCount: entities.filter((entity) => entity.kind === "node").length,
    edgeCount: entities.filter((entity) => entity.kind === "edge").length,
    groupCount: entities.filter((entity) => entity.kind === "group").length,
    diagnostics: result.diagnostics,
    direction: result.direction,
  };
}

export interface RunMermaidImportInput {
  readonly text: string;
  readonly snapshotId: SnapshotId;
  /** ISO-8601 timestamp for the import, supplied by the caller for determinism. */
  readonly importedAt: string;
}

/**
 * The result of a full import: the raw {@link MermaidImportResult} plus the snapshot with a
 * deterministic layout already attached (or `null` when parsing was fatal).
 */
export interface MermaidImportRun {
  readonly result: MermaidImportResult;
  readonly snapshot: GraphSnapshot | null;
}

/**
 * Runs a full import — parse, then deterministic layout — for the commit path. Kept behind a
 * function type so the editor can inject a synchronous stand-in in tests and skip ELK.
 */
export type RunMermaidImport = (
  input: RunMermaidImportInput,
) => Promise<MermaidImportRun>;

export const runMermaidImport: RunMermaidImport = async (input) => {
  const result = importMermaidFlowchart({
    text: input.text,
    snapshotId: input.snapshotId,
    importedAt: input.importedAt,
  });
  if (!result.snapshot) return { result, snapshot: null };
  const layout = await layoutFlowchart(result.snapshot, {
    direction: result.direction,
  });
  return { result, snapshot: { ...result.snapshot, layout } };
};
