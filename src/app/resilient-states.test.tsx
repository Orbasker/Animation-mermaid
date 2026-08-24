import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import AppError from "@/app/error";
import NotFound from "@/app/not-found";
import EditorError from "@/app/editor/error";
import {
  clearProjectBackup,
  recordProjectBackup,
} from "@/app/editor/project-backup";
import { sampleProjectDocument } from "@/domain/fixtures";

afterEach(() => {
  vi.restoreAllMocks();
  clearProjectBackup();
});

describe("root error boundary", () => {
  it("shows an actionable recovery state and retries", () => {
    const retry = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppError error={Object.assign(new Error("boom"), { digest: "d" })} retry={retry} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not leak the raw error message into the visible UI", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <AppError
        error={new Error("secret-token=abc123 stack trace detail")}
        retry={vi.fn()}
      />,
    );
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
  });
});

describe("not-found state", () => {
  it("offers a route back to the editor and home", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", { name: "This page doesn’t exist" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the editor" })).toHaveAttribute(
      "href",
      "/editor",
    );
  });
});

describe("editor error boundary", () => {
  it("offers a backup download when a backup exists and retries", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordProjectBackup(sampleProjectDocument());
    const retry = vi.fn();

    render(<EditorError error={new Error("crash")} retry={retry} />);

    expect(
      screen.getByRole("button", { name: "Download a backup" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload the workspace" }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it("omits the backup action when no project has been recorded", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<EditorError error={new Error("crash")} retry={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Download a backup" }),
    ).not.toBeInTheDocument();
  });
});
