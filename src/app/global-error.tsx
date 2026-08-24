"use client";

import { useEffect, useState } from "react";

import {
  buildDiagnostics,
  copyToClipboard,
  formatDiagnostics,
} from "@/app/_components/diagnostics";

/**
 * The last-resort boundary: it replaces the root layout when the layout itself throws, so it
 * renders its own document and cannot rely on the app's global styles reaching it. Everything it
 * needs is inlined.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.error("Global error boundary caught:", error);
  }, [error]);

  async function copyDiagnostics() {
    const diagnostics = buildDiagnostics({ scope: "global", error });
    const ok = await copyToClipboard(formatDiagnostics(diagnostics));
    setCopied(ok);
  }

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f5f3e9",
          color: "#10221d",
          fontFamily: "Arial, Helvetica, sans-serif",
          padding: "24px",
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: "520px",
            background: "#fffef8",
            border: "1px solid #d8d9c9",
            borderRadius: "16px",
            padding: "32px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.4rem" }}>
            The app needs to restart
          </h1>
          <p style={{ margin: 0, color: "#53665f", lineHeight: 1.5 }}>
            Something failed while loading the application shell. Your local
            project is saved in this browser and will be there when the app
            reloads.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
            <button
              onClick={() => retry()}
              type="button"
              style={{
                background: "#ff6a3d",
                border: "none",
                borderRadius: "999px",
                color: "#fffef8",
                cursor: "pointer",
                fontWeight: 700,
                padding: "12px 22px",
              }}
            >
              Reload the app
            </button>
            <button
              onClick={() => void copyDiagnostics()}
              type="button"
              style={{
                background: "transparent",
                border: "1px solid #d8d9c9",
                borderRadius: "999px",
                color: "#10221d",
                cursor: "pointer",
                fontWeight: 600,
                padding: "12px 22px",
              }}
            >
              Copy diagnostics
            </button>
          </div>
          <span aria-live="polite" style={{ minHeight: "1em", color: "#53665f" }}>
            {copied ? "Diagnostics copied to the clipboard." : ""}
          </span>
        </main>
      </body>
    </html>
  );
}
