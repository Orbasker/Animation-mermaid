import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { EditorWorkspace } from "@/app/editor/editor-workspace";
import { sampleProjectDocument } from "@/domain/fixtures";
import { createProjectDocument, projectId } from "@/domain/project-document";
import { ProjectRepository } from "@/persistence";

const repositories: ProjectRepository[] = [];

async function openRepository(): Promise<ProjectRepository> {
  const repository = await ProjectRepository.open({
    indexedDB: new IDBFactory(),
    databaseName: crypto.randomUUID(),
  });
  repositories.push(repository);
  return repository;
}

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
});

describe("EditorWorkspace", () => {
  it("seeds the editable fixture when a stored project has no snapshots", async () => {
    render(
      <EditorWorkspace
        initialProject={createProjectDocument({
          id: projectId("empty-project"),
          name: "Empty project",
        })}
      />,
    );

    expect(
      await screen.findByRole("button", { name: /Client\. Position 0, 0/i }),
    ).toBeInTheDocument();
  });

  it("selects and modifies components from the keyboard with undo support", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    const client = await screen.findByRole("button", {
      name: /Client\. Position 0, 0/i,
    });

    fireEvent.click(client);
    fireEvent.keyDown(client, { key: "ArrowRight" });

    expect(
      screen.getByRole("button", { name: /Client\. Position 10, 0/i }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide selected" }));
    expect(screen.queryByRole("button", { name: /Client\. Position/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: /Client\. Position 10, 0/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reimport source" }));
    expect(
      await screen.findByRole("button", { name: /Client\. Position 10, 0/i }),
    ).toBeInTheDocument();
  });

  it("groups a multi-selection and annotates the focused component", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    const client = await screen.findByRole("button", { name: /Client\. Position/i });
    const api = screen.getByRole("button", { name: /API Gateway\. Position/i });

    fireEvent.click(client);
    fireEvent.click(api, { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Group selection" }));
    expect(screen.getAllByText("Group 1 · 2 components")).toHaveLength(2);

    fireEvent.click(client);
    fireEvent.click(screen.getByRole("tab", { name: "Inspector" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Annotation for Client" }), {
      target: { value: "Public entry point" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));

    expect(screen.getAllByText("Public entry point")).toHaveLength(2);
  });

  it("autosaves document transactions and restores them on reload", async () => {
    const repository = await openRepository();
    const first = render(
      <EditorWorkspace
        autosaveDelayMs={0}
        initialProject={sampleProjectDocument()}
        repository={repository}
      />,
    );
    const client = await screen.findByRole("button", { name: /Client\. Position 0, 0/i });

    fireEvent.click(client);
    fireEvent.keyDown(client, { key: "ArrowDown" });
    await screen.findByText("Saved locally");
    first.unmount();

    render(<EditorWorkspace autosaveDelayMs={0} repository={repository} />);
    expect(
      await screen.findByRole("button", { name: /Client\. Position 0, 10/i }),
    ).toBeInTheDocument();
  });

  it("exposes review surfaces and loads the 200-node stress fixture", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });

    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText(/flowchart TD/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText("Request walkthrough")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));
    expect(screen.getByText(/current vs proposed/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load 200-node stress fixture" }));
    await waitFor(() => expect(screen.getByText("200 components")).toBeInTheDocument());
  });
});
