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
    expect(
      screen.queryByRole("button", { name: /Client\. Position/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getByRole("button", { name: /Client\. Position 10, 0/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reimport source" }));
    expect(
      await screen.findByRole("button", { name: /Client\. Position 10, 0/i }),
    ).toBeInTheDocument();
  });

  it("groups a multi-selection and annotates the focused component", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    const client = await screen.findByRole("button", {
      name: /Client\. Position/i,
    });
    const api = screen.getByRole("button", { name: /API Gateway\. Position/i });

    fireEvent.click(client);
    fireEvent.click(api, { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Group selection" }));
    expect(screen.getAllByText("Group 1 · 2 components")).toHaveLength(2);

    fireEvent.click(client);
    fireEvent.click(screen.getByRole("tab", { name: "Inspector" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Annotation for Client" }),
      {
        target: { value: "Public entry point" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));

    expect(screen.getAllByText("Public entry point")).toHaveLength(2);
  });

  it("renames, restyles, and deletes a component in-view with undo", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    const client = await screen.findByRole("button", {
      name: /Client\. Position/i,
    });

    fireEvent.click(client);
    fireEvent.click(screen.getByRole("tab", { name: "Inspector" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "Web Client" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(
      screen.getByRole("button", { name: /Web Client\. Position/i }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Shape" }), {
      target: { value: "stadium" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Color" }), {
      target: { value: "#3b82f6" },
    });
    expect(
      screen.getByRole("button", { name: /Web Client\. Position/i }),
    ).toHaveStyle({ borderColor: "#3b82f6" });

    fireEvent.click(screen.getByRole("button", { name: "Delete component" }));
    expect(
      screen.queryByRole("button", { name: /Web Client\. Position/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getByRole("button", { name: /Web Client\. Position/i }),
    ).toBeInTheDocument();
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
    const client = await screen.findByRole("button", {
      name: /Client\. Position 0, 0/i,
    });

    fireEvent.click(client);
    fireEvent.keyDown(client, { key: "ArrowDown" });
    await screen.findByText("Saved locally");
    first.unmount();

    render(<EditorWorkspace autosaveDelayMs={0} repository={repository} />);
    expect(
      await screen.findByRole(
        "button",
        { name: /Client\. Position 0, 10/i },
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
  });

  it("exposes review surfaces and loads the 200-node stress fixture", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });

    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText(/flowchart TD/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText("Request walkthrough")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Load 200-node stress fixture" }),
    );
    await waitFor(() =>
      expect(screen.getByText("200 components")).toBeInTheDocument(),
    );
  });

  it("authors a four-scene review and persists it through reload", async () => {
    const repository = await openRepository();
    const first = render(
      <EditorWorkspace
        autosaveDelayMs={0}
        initialProject={sampleProjectDocument()}
        repository={repository}
      />,
    );
    await screen.findByRole("button", { name: /Client\. Position/i });

    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText("3 scenes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add scene" }));
    expect(screen.getByText("4 scenes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Scene 4")).toBeInTheDocument();

    await screen.findByText("Saved locally");
    first.unmount();

    render(<EditorWorkspace autosaveDelayMs={0} repository={repository} />);
    await screen.findByRole("button", { name: /Client\. Position/i });
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(await screen.findByText("4 scenes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Scene 4")).toBeInTheDocument();
  });

  it("reorders scenes without losing any", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));

    expect(screen.getByRole("textbox", { name: "Scene 1 title" })).toHaveValue(
      "Client sends a request",
    );

    fireEvent.click(screen.getByRole("button", { name: "Move scene 1 later" }));

    expect(screen.getByRole("textbox", { name: "Scene 1 title" })).toHaveValue(
      "Backend handles it",
    );
    expect(screen.getByText("3 scenes")).toBeInTheDocument();
  });

  it("scrubs the timeline preview with the deterministic story engine", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));

    fireEvent.click(screen.getByRole("button", { name: "Enter preview" }));
    expect(
      screen.getByText(/Scene 1: Client sends a request/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("slider", { name: "Scrubber" }), {
      target: { value: "9999" },
    });
    expect(
      screen.getByText(/Scene 3: Persist to the database/),
    ).toBeInTheDocument();
  });

  it("adds an entity action to the selected scene from the canvas selection", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    const client = await screen.findByRole("button", {
      name: /Client\. Position/i,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    fireEvent.click(screen.getByRole("button", { name: "Scene 3" }));
    fireEvent.click(client);
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));

    expect(screen.getByText("Highlight client")).toBeInTheDocument();
  });

  const CATALOG = [
    "%% catalog-postgres — TO-BE",
    "flowchart LR",
    "  gw[Payments Gateway] --> db[(Ledger)]",
  ].join("\n");

  it("imports a pasted diagram as a new snapshot and switches to it", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });

    fireEvent.click(screen.getByRole("button", { name: "Import Mermaid" }));
    fireEvent.change(screen.getByLabelText("Mermaid source"), {
      target: { value: CATALOG },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Add to this project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import diagram" }));

    expect(
      await screen.findByRole("button", {
        name: /Payments Gateway\. Position/i,
      }),
    ).toBeInTheDocument();
    // A second snapshot means the diagram switcher appears with the new label.
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "catalog-postgres" }),
    ).toBeInTheDocument();
  });

  it("starts a fresh project from a pasted diagram", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });

    fireEvent.click(screen.getByRole("button", { name: "Import Mermaid" }));
    fireEvent.change(screen.getByLabelText("Mermaid source"), {
      target: { value: CATALOG },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Start a new project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import diagram" }));

    expect(
      await screen.findByRole("button", {
        name: /Payments Gateway\. Position/i,
      }),
    ).toBeInTheDocument();
    // A brand-new single-snapshot project has no switcher and no Client node.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Client\. Position/i }),
    ).not.toBeInTheDocument();
  });

  it("creates a first story for a snapshot that has none and enables export", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });

    fireEvent.click(screen.getByRole("button", { name: "Import Mermaid" }));
    fireEvent.change(screen.getByLabelText("Mermaid source"), {
      target: { value: CATALOG },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Start a new project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import diagram" }));
    await screen.findByRole("button", { name: /Payments Gateway\. Position/i });

    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText(/No story yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export HTML" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Create story" }));

    expect(screen.getByText("1 scene")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Scene 1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export HTML" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Enter preview" }),
    ).not.toBeDisabled();
  });

  it("shows a storage-health banner with a backup action for constrained storage", async () => {
    const repository = await openRepository();
    render(
      <EditorWorkspace
        autosaveDelayMs={0}
        initialProject={sampleProjectDocument()}
        repository={repository}
        storageHealth={{
          status: "degraded",
          available: true,
          persistent: false,
          usageBytes: 1,
          quotaBytes: 1_000_000,
          title: "Saved locally, but data can be cleared",
          detail: "Your work autosaves to this browser.",
          recommendBackup: true,
        }}
      />,
    );
    await screen.findByRole("button", { name: /Client\. Position/i });

    expect(
      screen.getByText("Saved locally, but data can be cleared"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export a backup" }),
    ).toBeInTheDocument();
  });

  it("backs up all projects and restores them into the editor", async () => {
    const source = await openRepository();
    const saved = await source.save(sampleProjectDocument());
    const backupJson = await source.exportAllProjects();

    const target = await openRepository();
    render(
      <EditorWorkspace
        autosaveDelayMs={0}
        initialProject={createProjectDocument({
          id: projectId("blank-target"),
          name: "Blank",
        })}
        repository={target}
      />,
    );
    await screen.findByRole("button", { name: /Client\. Position/i });

    const file = new File([backupJson], "backup.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText(
      "Restore projects from a backup file",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/Restored 1/)).toBeInTheDocument();
    const copy = (await target.list()).find(
      (entry) => entry.name === saved.document.name,
    );
    expect(copy).toBeDefined();
    const restored = await target.get(copy!.id);
    // Restored as a copy: identical content under a fresh id.
    expect({ ...restored!.document, id: saved.document.id }).toEqual(
      saved.document,
    );
  });

  it("rejects a fatal paste without committing", async () => {
    render(<EditorWorkspace initialProject={sampleProjectDocument()} />);
    await screen.findByRole("button", { name: /Client\. Position/i });

    fireEvent.click(screen.getByRole("button", { name: "Import Mermaid" }));
    fireEvent.change(screen.getByLabelText("Mermaid source"), {
      target: { value: "sequenceDiagram\n A->>B: hi" },
    });

    expect(
      screen.getByText(/not a valid Mermaid flowchart/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import diagram" }),
    ).toBeDisabled();
  });
});
