import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import EditorPage from "@/app/editor/page";
import HomePage from "@/app/page";

describe("application routes", () => {
  it("introduces the animation editor and links to it", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "Turn Mermaid diagrams into motion" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the editor" })).toHaveAttribute(
      "href",
      "/editor",
    );
  });

  it("marks the editor route as the next workspace", () => {
    render(<EditorPage />);

    expect(
      screen.getByRole("heading", { name: "Animation editor" }),
    ).toBeInTheDocument();
    expect(screen.getByText("The editing workspace is coming next.")).toBeInTheDocument();
  });
});

describe("test isolation", () => {
  it("renders temporary content", () => {
    render(<div>Temporary test content</div>);

    expect(screen.getByText("Temporary test content")).toBeInTheDocument();
  });

  it("starts with a clean document", () => {
    expect(screen.queryByText("Temporary test content")).not.toBeInTheDocument();
  });
});
