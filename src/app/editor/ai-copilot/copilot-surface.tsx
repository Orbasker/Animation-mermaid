"use client";

import type { Comparison } from "@/domain/comparison";
import type { GraphSnapshot } from "@/domain/graph";
import type { ProjectDocument } from "@/domain/project-document";
import type { StoryProposal } from "@/workflows/design-review-story";

import { CopilotPanel, type ApplyControls } from "./copilot-panel";
import type { CopilotTransport } from "./copilot-transport";
import { useCopilot } from "./use-copilot";

export interface CopilotSurfaceProps {
  readonly transport: CopilotTransport;
  readonly snapshot: GraphSnapshot;
  readonly comparison?: Comparison;
  readonly project: ProjectDocument;
  readonly defaultTitle: string;
  readonly initialRunId?: string;
  readonly onRunStarted?: (runId: string) => void;
  readonly onRunSettled?: (runId: string) => void;
  readonly onApplied?: (proposal: StoryProposal) => void;
  readonly applyControls?: ApplyControls;
  /** Whether the hosted AI copilot is reachable; when false the panel degrades gracefully. */
  readonly aiAvailable?: boolean;
}

/**
 * Wires the copilot hook to the panel. Kept a component of its own so it can stay mounted while
 * another workspace surface is shown — the run lifecycle lives in the hook, so switching tabs
 * must not tear it down.
 */
export function CopilotSurface({
  transport,
  snapshot,
  comparison,
  project,
  defaultTitle,
  initialRunId,
  onRunStarted,
  onRunSettled,
  onApplied,
  applyControls,
  aiAvailable,
}: CopilotSurfaceProps) {
  const controller = useCopilot({
    transport,
    snapshot,
    comparison,
    defaultTitle,
    initialRunId,
    onRunStarted,
    onRunSettled,
    onApplied,
  });

  return (
    <CopilotPanel
      aiAvailable={aiAvailable}
      applyControls={applyControls}
      controller={controller}
      project={project}
    />
  );
}
