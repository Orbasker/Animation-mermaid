import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { snapshotId, type GraphSnapshot } from "@/domain/graph";
import { importMermaidFlowchart } from "@/domain/mermaid/import";

import { ExplorerSurface } from "@/app/editor/explorer/explorer-surface";

const NESTED = `flowchart LR
  subgraph outer[Outer module]
    subgraph inner[Inner module]
      a[Alpha service]
      d[Delta service]
    end
    b[Beta service]
  end
  c(Gamma service)
  a --> b
  b --> c`;

function snapshotFrom(text: string): GraphSnapshot {
  const result = importMermaidFlowchart({
    text,
    snapshotId: snapshotId("explorer-surface-test"),
    importedAt: "1970-01-01T00:00:00.000Z",
  });
  if (!result.snapshot) throw new Error("fixture failed to import");
  return result.snapshot;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ExplorerSurface", () => {
  it("renders leaves and container frames, and collapse-all folds them into summaries", () => {
    render(<ExplorerSurface snapshot={snapshotFrom(NESTED)} />);

    expect(screen.getByText("Alpha service")).toBeInTheDocument();
    expect(screen.getByText("Outer module")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    // Alpha now lives inside the collapsed "outer" summary and is no longer drawn.
    expect(screen.queryByText("Alpha service")).not.toBeInTheDocument();
    expect(screen.getByText(/inside/)).toBeInTheDocument();
  });

  it("collapses a single container from its header toggle", () => {
    render(<ExplorerSurface snapshot={snapshotFrom(NESTED)} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Inner module" }),
    );

    expect(screen.queryByText("Alpha service")).not.toBeInTheDocument();
    // Beta stays visible: it is outside inner.
    expect(screen.getByText("Beta service")).toBeInTheDocument();
  });

  it("drills into a container and lets the breadcrumb navigate back out", () => {
    render(<ExplorerSurface snapshot={snapshotFrom(NESTED)} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Drill into Outer module" }),
    );

    // Gamma is outside outer, so the drilled view omits it.
    expect(screen.queryByText("Gamma service")).not.toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", {
      name: "Drill-down breadcrumb",
    });
    expect(
      within(breadcrumb).getByRole("button", { name: "Outer module" }),
    ).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(breadcrumb).getByRole("button", { name: "All" }));
    expect(screen.getByText("Gamma service")).toBeInTheDocument();
  });

  it("reports the number of search matches", () => {
    render(<ExplorerSurface snapshot={snapshotFrom(NESTED)} />);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "service" },
    });

    // Alpha, Delta, Beta, Gamma all match "service".
    expect(screen.getByText("4 matches")).toBeInTheDocument();
  });

  it("marks the stage reduced-motion when requested", () => {
    const { container } = render(
      <ExplorerSurface reducedMotion snapshot={snapshotFrom(NESTED)} />,
    );
    expect(
      container.querySelector(".explorer-reducedMotion"),
    ).toBeInTheDocument();
  });
});
