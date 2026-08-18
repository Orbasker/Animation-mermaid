"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import type { ImportDestination } from "@/domain/import-project";

import { previewMermaidImport } from "./run-import";

const ACCEPTED_EXTENSIONS = [".mmd", ".mermaid", ".txt"] as const;

interface DestinationOption {
  readonly value: ImportDestination;
  readonly label: string;
  readonly hint: string;
  /** When false, the option is only offered once a project is open. */
  readonly needsProject: boolean;
}

const DESTINATIONS: readonly DestinationOption[] = [
  {
    value: "new-project",
    label: "Start a new project",
    hint: "Create a fresh project from this diagram.",
    needsProject: false,
  },
  {
    value: "add-snapshot",
    label: "Add to this project",
    hint: "Keep the current diagram and add this one alongside it.",
    needsProject: true,
  },
  {
    value: "replace-active",
    label: "Replace the current diagram",
    hint: "Reimport into the active snapshot, keeping compatible visual edits.",
    needsProject: true,
  },
];

export interface ImportDialogSubmit {
  readonly text: string;
  readonly destination: ImportDestination;
}

export interface ImportDialogProps {
  /** Whether a project is already open — gates the replace/add destinations. */
  readonly hasProject: boolean;
  /** Label of the active snapshot, shown next to the replace option. */
  readonly activeSnapshotLabel?: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onSubmit: (input: ImportDialogSubmit) => void;
}

/**
 * The import dialog. Mount it only while open (e.g. `{isOpen ? <ImportDialog … /> : null}`) so
 * each opening starts from fresh state without resetting inside an effect.
 */
export function ImportDialog({
  hasProject,
  activeSnapshotLabel,
  busy = false,
  error,
  onCancel,
  onSubmit,
}: ImportDialogProps) {
  const [text, setText] = useState("");
  const [destination, setDestination] = useState<ImportDestination>(
    hasProject ? "add-snapshot" : "new-project",
  );
  const [fileError, setFileError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus the paste field once the dialog mounts so keyboard users land inside it.
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const preview = useMemo(() => previewMermaidImport(text), [text]);
  const options = useMemo(
    () => DESTINATIONS.filter((option) => hasProject || !option.needsProject),
    [hasProject],
  );

  const hasContent = text.trim().length > 0;
  const canCommit = hasContent && !preview.fatal && !busy;

  async function readFile(file: File): Promise<void> {
    setFileError(undefined);
    const named = ACCEPTED_EXTENSIONS.some((extension) =>
      file.name.toLowerCase().endsWith(extension),
    );
    if (!named && file.type && !file.type.startsWith("text/")) {
      setFileError(`"${file.name}" is not a Mermaid or text file.`);
      return;
    }
    try {
      setText(await file.text());
    } catch {
      setFileError(`"${file.name}" could not be read.`);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) void readFile(file);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void readFile(file);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    // Minimal focus trap: keep Tab cycling within the dialog's focusable controls.
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="importOverlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
        aria-labelledby="import-dialog-title"
        aria-modal="true"
        className="importDialog"
        onKeyDown={onKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="importDialogHeader">
          <h2 id="import-dialog-title">Import Mermaid</h2>
          <p>
            Paste a Mermaid flowchart or drop a <code>.mmd</code> file, then
            choose where it lands.
          </p>
        </div>

        <div
          className={dragging ? "importDropZone isDragging" : "importDropZone"}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDrop={onDrop}
        >
          <label className="importFieldLabel" htmlFor="import-source">
            Mermaid source
          </label>
          <textarea
            className="importTextarea"
            id="import-source"
            onChange={(event) => setText(event.target.value)}
            placeholder="flowchart LR&#10;  a[Service] --> b[(Database)]"
            ref={textareaRef}
            rows={12}
            spellCheck={false}
            value={text}
          />
          <div className="importUploadRow">
            <label className="importUploadButton">
              Upload file
              <input
                accept={ACCEPTED_EXTENSIONS.join(",")}
                onChange={onFileChange}
                type="file"
              />
            </label>
            <span className="importUploadHint">
              …or drag a file onto this area.
            </span>
          </div>
        </div>

        {fileError ? (
          <p className="importFileError" role="alert">
            {fileError}
          </p>
        ) : null}

        <div aria-live="polite" className="importPreview">
          {!hasContent ? (
            <p className="importPreviewEmpty">
              Nothing to import yet — paste or upload a diagram.
            </p>
          ) : preview.fatal ? (
            <p className="importPreviewFatal">
              This is not a valid Mermaid flowchart, so it can’t be imported.
            </p>
          ) : (
            <p className="importPreviewCounts">
              <strong>{preview.nodeCount}</strong> components,{" "}
              <strong>{preview.edgeCount}</strong> connections,{" "}
              <strong>{preview.groupCount}</strong> groups
              {preview.ok ? "" : " — some constructs were skipped"}
            </p>
          )}
          {preview.diagnostics.length > 0 ? (
            <ul className="importDiagnostics">
              {preview.diagnostics.map((diagnostic, index) => (
                <li
                  className={`importDiagnostic sev-${diagnostic.severity}`}
                  key={`${diagnostic.code}-${diagnostic.line}-${index}`}
                >
                  <span className="importDiagnosticLoc">
                    line {diagnostic.line}
                    {diagnostic.column ? `:${diagnostic.column}` : ""}
                  </span>{" "}
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <fieldset className="importDestinations">
          <legend>Where should it go?</legend>
          {options.map((option) => (
            <label className="importDestination" key={option.value}>
              <input
                checked={destination === option.value}
                name="import-destination"
                onChange={() => setDestination(option.value)}
                type="radio"
                value={option.value}
              />
              <span className="importDestinationBody">
                <span className="importDestinationLabel">
                  {option.label}
                  {option.value === "replace-active" && activeSnapshotLabel
                    ? ` (${activeSnapshotLabel})`
                    : ""}
                </span>
                <span className="importDestinationHint">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {error ? (
          <p className="importCommitError" role="alert">
            {error}
          </p>
        ) : null}

        <div className="importActions">
          <button className="importCancel" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="importCommit"
            disabled={!canCommit}
            onClick={() => onSubmit({ text, destination })}
            type="button"
          >
            {busy ? "Importing…" : "Import diagram"}
          </button>
        </div>
      </div>
    </div>
  );
}
