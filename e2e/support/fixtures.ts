import type { Page } from "@playwright/test";

import baseline from "../fixtures/baseline.json";

/**
 * The scripted copilot run the AI journeys drive, assembled from the shared baseline fixture so
 * the browser flow and the domain tests agree on the same cached-read proposal.
 */
export const COPILOT_FIXTURE = {
  runId: "wrun_e2e_baseline",
  progress: baseline.progress,
  proposal: baseline.proposal,
  approvedOutcome: baseline.approvedOutcome,
} as const;

/** The intent the baseline request describes; typed into the copilot compose form. */
export const BASELINE_INTENT = baseline.request.context.intent;

/** The proposed story's title, shown once the run reaches the approval gate. */
export const PROPOSAL_TITLE = baseline.proposal.story.title;

/**
 * Installs the scripted copilot transport for every page load in this context. `addInitScript`
 * re-runs on reload, which is what lets the reconnect journey rejoin the "active" run after a
 * navigation.
 */
export async function installCopilotFixture(page: Page): Promise<void> {
  await page.addInitScript((fixture) => {
    (window as unknown as { __E2E_COPILOT__: unknown }).__E2E_COPILOT__ = fixture;
  }, COPILOT_FIXTURE);
}
