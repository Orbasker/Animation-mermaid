import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorWorkspace } from "@/app/editor/editor-workspace";
import { sampleProjectDocument } from "@/domain/fixtures";
import { clearProjectBackup, readProjectBackup } from "./project-backup";

afterEach(() => {
  clearProjectBackup();
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
});

describe("editor resilience states", () => {
  it("keeps local editing available and pauses AI when offline", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position 0, 0/i });

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(
      await screen.findByText("You’re offline — local editing still works"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Copilot" }));
    expect(
      screen.getByText("AI copilot paused — you’re offline"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview request" }),
    ).toBeDisabled();

    // Local editing controls stay usable.
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("records a project backup that a recovery surface could export", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position 0, 0/i });

    await waitFor(() => expect(readProjectBackup()).toBeDefined());
    expect(readProjectBackup()?.project.snapshots.length).toBeGreaterThan(0);
  });
});
