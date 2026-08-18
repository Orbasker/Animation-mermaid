import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { EditorWorkspace } from "@/app/editor/editor-workspace";
import { entityId, snapshotId } from "@/domain/graph";
import { sampleProjectDocument } from "@/domain/fixtures";
import { createStory, sceneId, storyId } from "@/domain/story";
import { ProjectRepository } from "@/persistence";
import type {
  ProgressEvent,
  StoryOutcome,
  StoryPhase,
  StoryProposal,
  StoryRequest,
} from "@/workflows/design-review-story";

import {
  classifyFailureMessage,
  type CopilotTransport,
  type RunSnapshot,
} from "./copilot-transport";

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

function proposalFixture(): StoryProposal {
  const story = createStory({
    id: storyId("story-ai-1"),
    title: "AI proposed walkthrough",
    snapshotId: snapshotId("snap-current"),
    scenes: [
      {
        id: sceneId("scene-1"),
        title: "Client calls the API",
        durationMs: 2000,
        actions: [
          { type: "reveal", target: entityId("client") },
          { type: "reveal", target: entityId("api") },
        ],
      },
      {
        id: sceneId("scene-2"),
        title: "Service handles it",
        durationMs: 2000,
        actions: [
          { type: "highlight", target: entityId("service"), style: "active" },
        ],
      },
    ],
  });
  return {
    proposalId: "prop_test",
    story,
    totalDurationMs: 4000,
    analysis: {
      thesis: "A request flows client → api → service.",
      audience: "Engineers reviewing the design.",
      beats: [
        { summary: "Client calls the API.", entityIds: [entityId("client")] },
      ],
    },
    critique: {
      verdict: "ready_with_notes",
      summary: "The scenes follow the thesis.",
      notes: [{ note: "Consider a longer hold on the last scene." }],
    },
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function event(phase: StoryPhase, message: string): ProgressEvent {
  return { phase, message };
}

/**
 * A scripted, in-memory {@link CopilotTransport}. It reproduces the durable run lifecycle —
 * progress up to the approval gate, a suspend, then a settle driven by the client's decision —
 * without a workflow runtime, so the panel's behavior is exercised deterministically.
 */
class FakeTransport implements CopilotTransport {
  readonly started: StoryRequest[] = [];
  private readonly runId = "run-fake";
  private readonly gate = deferred();
  private decision?: "approve" | "reject";
  private cancelled = false;
  private streamEnded = false;

  constructor(
    private readonly options: {
      readonly proposal: StoryProposal;
      readonly failWith?: string;
    },
  ) {}

  private get approvedOutcome(): StoryOutcome {
    return {
      status: "approved",
      proposal: this.options.proposal,
      agentSessionId: "sess",
    };
  }

  private get rejectedOutcome(): StoryOutcome {
    return { status: "rejected", agentSessionId: "sess" };
  }

  async start(request: StoryRequest) {
    this.started.push(request);
    return { runId: this.runId };
  }

  async status(runId: string): Promise<RunSnapshot> {
    if (this.cancelled) return { runId, status: "cancelled" };
    if (this.options.failWith) {
      return this.streamEnded
        ? {
            runId,
            status: "failed",
            error: classifyFailureMessage(this.options.failWith),
          }
        : { runId, status: "running" };
    }
    if (this.decision === "approve") {
      return { runId, status: "completed", outcome: this.approvedOutcome };
    }
    if (this.decision === "reject") {
      return { runId, status: "completed", outcome: this.rejectedOutcome };
    }
    return { runId, status: "running" };
  }

  async *streamProgress(): AsyncGenerator<ProgressEvent> {
    yield event("validating-context", "Checking the context package.");
    if (this.options.failWith) {
      this.streamEnded = true;
      return;
    }
    yield event("analyzing-narrative", "Asking for the narrative arc.");
    yield event("generating-scenes", "Drafting scenes.");
    yield event("critiquing", "Reviewing the draft.");
    yield event("awaiting-approval", "Waiting for a decision.");
    await this.gate.promise;
    if (this.cancelled) return;
    yield event("settled", `The reviewer chose to ${this.decision}.`);
  }

  async proposal() {
    return this.options.proposal;
  }

  async decide(_runId: string, decision: { decision: "approve" | "reject" }) {
    this.decision = decision.decision;
    this.gate.resolve();
  }

  async cancel() {
    this.cancelled = true;
    this.gate.resolve();
  }
}

async function openCopilot(
  transport: CopilotTransport,
  options: { repository?: ProjectRepository } = {},
) {
  render(
    <EditorWorkspace
      autosaveDelayMs={0}
      copilotTransport={transport}
      initialProject={sampleProjectDocument()}
      {...(options.repository ? { repository: options.repository } : {})}
    />,
  );
  await screen.findByRole("button", { name: /Client\. Position/i });
  fireEvent.click(screen.getByRole("tab", { name: "Copilot" }));
}

function compose(intent: string) {
  fireEvent.change(
    screen.getByLabelText("What should the animation explain?"),
    {
      target: { value: intent },
    },
  );
}

async function driveToReview() {
  compose("Explain how a request reaches the database.");
  fireEvent.click(screen.getByRole("button", { name: "Preview request" }));
  fireEvent.click(screen.getByRole("button", { name: /Confirm & generate/ }));
  await screen.findByText("AI proposed walkthrough");
}

describe("AI copilot", () => {
  it("does not start a request until the context preview is confirmed", async () => {
    const transport = new FakeTransport({ proposal: proposalFixture() });
    await openCopilot(transport);

    // No generate control exists before previewing.
    expect(
      screen.queryByRole("button", { name: /Confirm & generate/ }),
    ).toBeNull();

    compose("Explain the request path.");
    fireEvent.click(screen.getByRole("button", { name: "Preview request" }));

    // Previewing shows the confirm control but has still sent nothing.
    expect(
      screen.getByRole("button", { name: /Confirm & generate/ }),
    ).toBeInTheDocument();
    expect(transport.started).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Confirm & generate/ }));
    await waitFor(() => expect(transport.started).toHaveLength(1));
  });

  it("excludes deselected components from the request fixture", async () => {
    const transport = new FakeTransport({ proposal: proposalFixture() });
    await openCopilot(transport);

    compose("Explain the request path.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Database/ }));
    fireEvent.click(screen.getByRole("button", { name: "Preview request" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & generate/ }));

    await waitFor(() => expect(transport.started).toHaveLength(1));
    const request = transport.started[0];
    const ids = request.context.graph.entities.map((entity) => entity.id);
    expect(ids).not.toContain("db");
    // The edge into the dropped node is pruned, not left dangling.
    expect(JSON.stringify(request.context)).not.toContain("service->db");
  });

  it("applies an approved proposal as one undoable transaction", async () => {
    const transport = new FakeTransport({ proposal: proposalFixture() });
    await openCopilot(transport);
    await driveToReview();

    fireEvent.click(screen.getByRole("button", { name: "Apply to project" }));
    await screen.findByText("Applied to your project");

    // The story now appears on the Story surface.
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText("AI proposed walkthrough")).toBeInTheDocument();

    // Undo reverts the single transaction; redo restores it.
    fireEvent.click(screen.getByRole("tab", { name: "Copilot" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo apply" }));
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.queryByText("AI proposed walkthrough")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Copilot" }));
    fireEvent.click(screen.getByRole("button", { name: "Redo apply" }));
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText("AI proposed walkthrough")).toBeInTheDocument();
  });

  it("leaves the project unchanged when a proposal is rejected", async () => {
    const transport = new FakeTransport({ proposal: proposalFixture() });
    await openCopilot(transport);
    await driveToReview();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await screen.findByText("Discarded");

    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText("Request walkthrough")).toBeInTheDocument();
    expect(screen.queryByText("AI proposed walkthrough")).toBeNull();
  });

  it("preserves local work and explains the next action on failure", async () => {
    const transport = new FakeTransport({
      proposal: proposalFixture(),
      failWith:
        "The agent rejected the request with 402; retrying cannot help: budget exceeded",
    });
    await openCopilot(transport);

    compose("Explain the request path.");
    fireEvent.click(screen.getByRole("button", { name: "Preview request" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & generate/ }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/budget is exhausted/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start over" }),
    ).toBeInTheDocument();

    // The local project is untouched — the original story is still the only one.
    fireEvent.click(screen.getByRole("tab", { name: "Story" }));
    expect(screen.getByText("Request walkthrough")).toBeInTheDocument();
    expect(screen.queryByText("AI proposed walkthrough")).toBeNull();
  });

  it("reconnects to an active run after a reload", async () => {
    const repository = await openRepository();
    const transport = new FakeTransport({ proposal: proposalFixture() });

    const first = render(
      <EditorWorkspace
        autosaveDelayMs={0}
        copilotTransport={transport}
        initialProject={sampleProjectDocument()}
        repository={repository}
      />,
    );
    await screen.findByRole("button", { name: /Client\. Position/i });
    fireEvent.click(screen.getByRole("tab", { name: "Copilot" }));
    compose("Explain the request path.");
    fireEvent.click(screen.getByRole("button", { name: "Preview request" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & generate/ }));
    await waitFor(() => expect(transport.started).toHaveLength(1));
    await screen.findByText("AI proposed walkthrough");

    first.unmount();

    // A fresh mount with no initialProject loads from the repository and rejoins the run.
    render(
      <EditorWorkspace
        autosaveDelayMs={0}
        copilotTransport={transport}
        repository={repository}
      />,
    );
    await screen.findByRole("button", { name: /Client\. Position/i });
    fireEvent.click(screen.getByRole("tab", { name: "Copilot" }));
    expect(
      await screen.findByText("AI proposed walkthrough"),
    ).toBeInTheDocument();
  });
});
