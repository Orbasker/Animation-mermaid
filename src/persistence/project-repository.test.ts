import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ProjectRepository,
  RepositoryError,
  type AiRunReference,
} from "@/persistence";
import { createProjectDocument, projectId } from "@/domain/project-document";
import { createStory, storyId } from "@/domain/story";
import { snapshotId } from "@/domain/graph";
import { serializeProjectDocument } from "@/domain/serialization";
import { sampleProjectDocument } from "@/domain/fixtures";

const DATABASE_NAME = "animation-mermaid-test";

/** Deterministic, strictly increasing ISO clock so `updatedAt` ordering is stable. */
function makeClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000).toISOString();
}

/** Deterministic id generator: id-1, id-2, … */
function makeIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

function openRepository(factory: IDBFactory): Promise<ProjectRepository> {
  return ProjectRepository.open({
    indexedDB: factory,
    databaseName: DATABASE_NAME,
    now: makeClock(),
    newId: makeIds(),
  });
}

const SAMPLE_RUN: AiRunReference = {
  runId: "run-abc",
  provider: "hosted-agent",
  createdAt: "2026-01-01T00:00:00.000Z",
  status: "queued",
};

describe("ProjectRepository lifecycle", () => {
  let factory: IDBFactory;
  let repo: ProjectRepository;

  beforeEach(async () => {
    factory = new IDBFactory();
    repo = await openRepository(factory);
  });

  it("creates, lists, and renames projects", async () => {
    const created = await repo.create({ name: "First" });
    expect(created.document.id).toBe("id-1");
    expect(created.meta.revision).toBe(1);

    const renamed = await repo.rename(created.document.id, "Renamed");
    expect(renamed.document.name).toBe("Renamed");

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "id-1", name: "Renamed" });
  });

  it("duplicates a project into an independent copy with a fresh id", async () => {
    const original = await repo.save(sampleProjectDocument());
    const copy = await repo.duplicate(original.document.id);

    expect(copy.document.id).not.toBe(original.document.id);
    expect(copy.document.name).toBe("Copy of Sample architecture story");
    expect(copy.document.snapshots).toEqual(original.document.snapshots);

    await repo.rename(copy.document.id, "Only the copy changed");
    const untouched = await repo.get(original.document.id);
    expect(untouched?.document.name).toBe(original.document.name);
  });

  it("archives out of the default list and unarchives back into it", async () => {
    const created = await repo.create({ name: "Archivable" });

    await repo.archive(created.document.id);
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.list({ includeArchived: true })).toHaveLength(1);

    await repo.unarchive(created.document.id);
    expect(await repo.list()).toHaveLength(1);
  });

  it("deletes a project and its linked AI runs", async () => {
    const created = await repo.create({ name: "Doomed" });
    await repo.linkAiRun(created.document.id, SAMPLE_RUN);

    await repo.delete(created.document.id);

    expect(await repo.get(created.document.id)).toBeUndefined();
    expect(await repo.aiRuns(created.document.id)).toEqual([]);
  });

  it("reports missing projects with typed errors", async () => {
    expect(await repo.get(projectId("missing"))).toBeUndefined();
    await expect(repo.rename(projectId("missing"), "x")).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(repo.export(projectId("missing"))).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });
});

describe("ProjectRepository persistence and reload", () => {
  it("restores graph, positions, scenes, and source exactly after reopening", async () => {
    const factory = new IDBFactory();
    const sample = sampleProjectDocument();

    const first = await openRepository(factory);
    await first.save(sample);
    first.close();

    const reopened = await openRepository(factory);
    const restored = await reopened.get(sample.id);

    expect(restored?.document).toEqual(sample);
    // Layout positions and scene timing survive the round trip intact.
    expect(restored?.document.snapshots[0].layout).toEqual(
      sample.snapshots[0].layout,
    );
    expect(restored?.document.stories[0].scenes).toEqual(
      sample.stories[0].scenes,
    );
    expect(restored?.document.snapshots[0].source.text).toBe(
      sample.snapshots[0].source.text,
    );
  });
});

describe("ProjectRepository portable JSON", () => {
  it("exports canonical JSON that re-imports into a fresh browser profile", async () => {
    const sample = sampleProjectDocument();

    const profileA = await openRepository(new IDBFactory());
    await profileA.save(sample);
    const json = await profileA.export(sample.id);

    const profileB = await openRepository(new IDBFactory());
    const imported = await profileB.import(json);

    expect(imported.document).toEqual(sample);
  });

  it("export contains only canonical content — no metadata or AI runs", async () => {
    const sample = sampleProjectDocument();
    const repo = await openRepository(new IDBFactory());
    await repo.save(sample);
    await repo.linkAiRun(sample.id, SAMPLE_RUN);

    const json = await repo.export(sample.id);

    expect(json).not.toContain("run-abc");
    expect(json).not.toContain("revision");
    expect(json).not.toContain("archivedAt");
    expect(JSON.parse(json)).toEqual(sample);
  });

  it("rejects a duplicate import unless asked to import as a copy", async () => {
    const sample = sampleProjectDocument();
    const repo = await openRepository(new IDBFactory());
    const json = serializeProjectDocument(sample);

    await repo.import(json);
    await expect(repo.import(json)).rejects.toMatchObject({
      code: "already-exists",
    });

    const copy = await repo.import(json, { asCopy: true });
    expect(copy.document.id).not.toBe(sample.id);
    expect(await repo.list()).toHaveLength(2);
  });

  it("fails safely on an unsupported/future schema version", async () => {
    const repo = await openRepository(new IDBFactory());
    const future = JSON.stringify({
      ...sampleProjectDocument(),
      schemaVersion: 99,
    });

    await expect(repo.import(future)).rejects.toMatchObject({
      code: "invalid-import",
    });
    expect(await repo.list()).toHaveLength(0);
  });

  it("fails safely on a document with broken referential integrity", async () => {
    const broken = createProjectDocument({
      id: projectId("p-broken"),
      name: "Broken",
      stories: [
        createStory({
          id: storyId("story-x"),
          title: "orphan",
          snapshotId: snapshotId("does-not-exist"),
          scenes: [],
        }),
      ],
    });

    const repo = await openRepository(new IDBFactory());
    await expect(repo.import(JSON.stringify(broken))).rejects.toMatchObject({
      code: "invalid-import",
    });
    expect(await repo.list()).toHaveLength(0);
  });

  it("fails safely on a payload that is not a JSON object", async () => {
    const repo = await openRepository(new IDBFactory());
    await expect(repo.import("[]")).rejects.toMatchObject({
      code: "invalid-import",
    });
  });
});

describe("ProjectRepository AI run separation", () => {
  it("keeps hosted run identifiers out of the canonical document", async () => {
    const sample = sampleProjectDocument();
    const repo = await openRepository(new IDBFactory());
    await repo.save(sample);

    await repo.linkAiRun(sample.id, SAMPLE_RUN);
    await repo.linkAiRun(sample.id, { ...SAMPLE_RUN, runId: "run-def" });

    const runs = await repo.aiRuns(sample.id);
    expect(runs.map((run) => run.runId)).toEqual(["run-abc", "run-def"]);

    const stored = await repo.get(sample.id);
    expect(stored?.document).toEqual(sample);
    expect(JSON.stringify(stored?.document)).not.toContain("run-abc");
  });

  it("refuses to link a run to a project that does not exist", async () => {
    const repo = await openRepository(new IDBFactory());
    await expect(
      repo.linkAiRun(projectId("missing"), SAMPLE_RUN),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});
