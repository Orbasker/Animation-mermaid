"use client";

import { useCallback, useState, type ReactNode } from "react";

import {
  buildDiagnostics,
  copyToClipboard,
  formatDiagnostics,
  type ProjectSummary,
} from "./diagnostics";

export type RecoveryTone = "error" | "warning" | "info";

export interface RecoveryAction {
  readonly label: string;
  readonly onClick: () => void;
  /** Renders as the emphasized action; use for the primary recovery path. */
  readonly primary?: boolean;
}

export interface RecoveryStateProps {
  /** Short scope label baked into copied diagnostics, e.g. "editor". */
  readonly scope: string;
  readonly title: string;
  readonly description: ReactNode;
  readonly tone?: RecoveryTone;
  /** The caught error, if this surface is standing in for a crash. */
  readonly error?: unknown;
  /** Re-render the segment that failed. Rendered as the first, primary action. */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  /** Extra recovery actions (export a backup, go home, switch to preview…). */
  readonly actions?: readonly RecoveryAction[];
  /** Non-identifying counts for diagnostics; never diagram contents. */
  readonly projectSummary?: ProjectSummary;
  /** Hides the copy-diagnostics control for surfaces where it adds no value. */
  readonly hideDiagnostics?: boolean;
}

/**
 * The shared recovery surface for every degraded app state — a crashed segment, offline, a
 * missing browser capability. It gives one clear heading, an explanation, an accessible retry,
 * any extra recovery actions, and a copy-diagnostics control whose payload is privacy-safe by
 * construction (see {@link buildDiagnostics}).
 */
export function RecoveryState({
  scope,
  title,
  description,
  tone = "error",
  error,
  onRetry,
  retryLabel = "Try again",
  actions,
  projectSummary,
  hideDiagnostics,
}: RecoveryStateProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const copyDiagnostics = useCallback(async () => {
    const diagnostics = buildDiagnostics({ scope, error, projectSummary });
    const ok = await copyToClipboard(formatDiagnostics(diagnostics));
    setCopyState(ok ? "copied" : "failed");
  }, [scope, error, projectSummary]);

  return (
    <div
      className={`recoveryState recoveryState-${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className="recoveryStateBody">
        <h2 className="recoveryStateTitle">{title}</h2>
        <div className="recoveryStateDescription">{description}</div>
      </div>
      <div className="recoveryStateActions">
        {onRetry ? (
          <button
            className="recoveryPrimaryAction"
            onClick={onRetry}
            type="button"
          >
            {retryLabel}
          </button>
        ) : null}
        {actions?.map((action) => (
          <button
            className={
              action.primary ? "recoveryPrimaryAction" : "recoverySecondaryAction"
            }
            key={action.label}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ))}
        {hideDiagnostics ? null : (
          <button
            className="recoverySecondaryAction"
            onClick={() => void copyDiagnostics()}
            type="button"
          >
            Copy diagnostics
          </button>
        )}
      </div>
      <span aria-live="polite" className="srOnly">
        {copyState === "copied"
          ? "Diagnostics copied to the clipboard."
          : copyState === "failed"
            ? "Could not copy diagnostics."
            : ""}
      </span>
    </div>
  );
}
