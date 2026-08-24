import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecoveryState } from "./recovery-state";

describe("RecoveryState", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders errors as an assertive alert with a retry", async () => {
    const onRetry = vi.fn();
    render(
      <RecoveryState
        scope="editor"
        title="It broke"
        description={<p>Something failed.</p>}
        error={new Error("boom")}
        onRetry={onRetry}
        retryLabel="Reload"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("It broke");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("copies privacy-safe diagnostics without project contents", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
      onLine: true,
      userAgent: "test",
    });

    render(
      <RecoveryState
        scope="editor"
        title="It broke"
        description={<p>Something failed.</p>}
        error={new Error("boom")}
        projectSummary={{ snapshots: 1, nodes: 3, edges: 2, stories: 0 }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('"scope": "editor"');
    expect(copied).toContain('"nodes": 3');
    expect(copied).not.toMatch(/annotation|source text/i);

    expect(
      await screen.findByText("Diagnostics copied to the clipboard."),
    ).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("renders extra recovery actions", async () => {
    const onExport = vi.fn();
    render(
      <RecoveryState
        scope="editor"
        title="It broke"
        description="failed"
        actions={[{ label: "Download a backup", onClick: onExport }]}
        hideDiagnostics
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download a backup" }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Copy diagnostics" }),
    ).not.toBeInTheDocument();
  });
});
