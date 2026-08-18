import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyStoryProposal,
  planStoryApplication,
} from "@/domain/apply-proposal";
import { sampleProjectDocument } from "@/domain/fixtures";
import { validateProjectDocument } from "@/domain/project-document";
import { validateStory } from "@/domain/story";
import { currentArchitectureSnapshot } from "@/domain/fixtures";

import { buildBaselineFixture } from "./e2e-fixture";

/**
 * The Playwright browser journey reads `e2e/fixtures/baseline.json` to drive the AI flow with a
 * cached-read proposal. That file is generated from {@link buildBaselineFixture}; these tests are
 * the contract that keeps it honest — the fixture must stay a valid, applicable proposal, and the
 * committed JSON must match what the domain produces today.
 *
 * Regenerate after an intentional change with:
 *   WRITE_E2E_FIXTURES=1 pnpm test:unit -- e2e-fixture
 */

const FIXTURE_PATH = resolve(process.cwd(), "e2e/fixtures/baseline.json");

describe("baseline e2e fixture", () => {
  const fixture = buildBaselineFixture();

  it("is deterministic — two builds are byte-for-byte equal", () => {
    expect(buildBaselineFixture()).toEqual(fixture);
  });

  it("proposes a story for the sample 'current' snapshot", () => {
    expect(fixture.proposal.story.snapshotId).toBe(
      currentArchitectureSnapshot().id,
    );
    expect(fixture.proposal.story.scenes).toHaveLength(4);
    expect(fixture.request.sceneCount).toBe(4);
  });

  it("validates against the snapshot it animates", () => {
    const errors = validateStory(
      fixture.proposal.story,
      currentArchitectureSnapshot(),
    );
    expect(errors).toEqual([]);
  });

  it("applies to the sample project as one appended, valid story", () => {
    const project = sampleProjectDocument();
    const plan = planStoryApplication(project, fixture.proposal.story);
    expect(plan.applicable).toBe(true);

    const next = applyStoryProposal(project, fixture.proposal.story);
    expect(next).not.toBe(project);
    expect(next.stories).toHaveLength(project.stories.length + 1);
    expect(validateProjectDocument(next)).toEqual([]);
  });

  it("rejects cleanly — an approved outcome carries the same proposal", () => {
    expect(fixture.approvedOutcome.status).toBe("approved");
    expect(fixture.approvedOutcome.proposal).toEqual(fixture.proposal);
  });

  it("matches the committed JSON the browser journey reads", () => {
    const serialized = `${JSON.stringify(fixture, null, 2)}\n`;

    if (process.env.WRITE_E2E_FIXTURES) {
      writeFileSync(FIXTURE_PATH, serialized);
    }

    const onDisk = readFileSync(FIXTURE_PATH, "utf8");
    expect(onDisk).toBe(serialized);
  });
});
