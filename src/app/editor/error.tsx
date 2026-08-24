"use client";

import { useEffect, useMemo } from "react";

import { RecoveryState } from "@/app/_components/recovery-state";
import type { RecoveryAction } from "@/app/_components/recovery-state";

import {
  downloadProjectBackup,
  readProjectBackup,
  summarizeProject,
} from "./project-backup";

export default function EditorError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Editor error boundary caught:", error);
  }, [error]);

  const backup = useMemo(() => readProjectBackup(), []);

  const actions: RecoveryAction[] = [];
  if (backup) {
    actions.push({
      label: "Download a backup",
      onClick: () => {
        downloadProjectBackup();
      },
    });
  }

  return (
    <div className="editorRecovery">
      <RecoveryState
        scope="editor"
        tone="error"
        title="The editor hit a problem"
        description={
          <>
            <p>
              The workspace stopped responding. Retrying reloads it from your
              locally saved project — nothing you saved is lost.
            </p>
            {backup ? (
              <p className="recoveryStateHint">
                You can also download a backup of your current project before
                retrying.
              </p>
            ) : null}
          </>
        }
        error={error}
        onRetry={retry}
        retryLabel="Reload the workspace"
        actions={actions}
        projectSummary={backup ? summarizeProject(backup.project) : undefined}
      />
    </div>
  );
}
