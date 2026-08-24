"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { RecoveryState } from "@/app/_components/recovery-state";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Route error boundary caught:", error);
  }, [error]);

  return (
    <main className="recoveryShell">
      <RecoveryState
        scope="app"
        tone="error"
        title="Something went wrong"
        description={
          <p>
            A part of the page failed to load. Retrying re-runs just this
            section — your saved work is untouched.
          </p>
        }
        error={error}
        onRetry={retry}
        actions={[
          {
            label: "Back to home",
            onClick: () => router.push("/"),
          },
        ]}
      />
      <p className="recoveryFootNote">
        Still stuck? <Link href="/editor">Reopen the editor</Link> — your local
        project is stored in this browser.
      </p>
    </main>
  );
}
