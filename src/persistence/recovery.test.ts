import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  ProjectRepository,
  RepositoryError,
  openDatabase,
  promisifyRequest,
  runTransaction,
} from "@/persistence";
import { sampleProjectDocument } from "@/domain/fixtures";

const DATABASE_NAME = "animation-mermaid-recovery-test";

function makeClock(): () => string {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000).toISOString();
}

function makeIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

function open(factory: IDBFactory): Promise<ProjectRepository> {
  return ProjectRepository.open({
    indexedDB: factory,
    databaseName: DATABASE_NAME,
    now: makeClock(),
    newId: makeIds(),
  });
}

/** A version-1 project document that the migration path steps forward to version 2. */
function legacyDocument() {
  const base = sampleProjectDocument();
  return {
    ...base,
    schemaVersion: 1,
    snapshots: base.snapshots.map((snapshot) => ({
      ...snapshot,
      schemaVersion: 1,
    })),
    stories: base.stories.map((story) => ({ ...story, schemaVersion: 1 })),
  };
}

/** Writes a raw row straight into the projects store, bypassing repository validation. */
async function seedRawRow(factory: IDBFactory, row: unknown): Promise<void> {
  const db = await openDatabase(factory, DATABASE_NAME, 2, (database) => {
    if (!database.objectStoreNames.contains("projects")) {
      database.createObjectStore("projects", { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains("aiRuns")) {
      database.createObjectStore("aiRuns", { keyPath: "projectId" });
    }
    if (!database.objectStoreNames.contains("recovery")) {
      database.createObjectStore("recovery", { keyPath: "id" });
    }
  });
  await runTransaction(db, "projects", "readwrite", (transaction) =>
    promisifyRequest(transaction.objectStore("projects").put(row)),
  );
  db.close();
}

describe("ProjectRepository migration recovery", () => {
  it("preserves the original before migrating an older stored document forward", async () => {
    const factory = new IDBFactory();
    const repo = await open(factory);
    const legacy = legacyDocument();
    const meta = {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      revision: 3,
    };
    await seedRawRow(factory, { id: legacy.id, document: legacy, meta });

    const report = await repo.recoverStoredProjects();

    expect(report.migrated).toContain(legacy.id);
    const stored = await repo.get(legacy.id);
    expect(stored?.document.schemaVersion).toBe(2);
    // Local metadata (revision, timestamps) survives the migration.
    expect(stored?.meta.revision).toBe(3);

    const recovery = await repo.listRecovery();
    expect(recovery).toHaveLength(1);
    expect(recovery[0].reason).toBe("pre-migration");
    expect(recovery[0].fromSchemaVersion).toBe(1);
    expect(JSON.parse(recovery[0].raw).schemaVersion).toBe(1);

    repo.close();
  });

  it("restores the recovered project from its preserved snapshot", async () => {
    const factory = new IDBFactory();
    const repo = await open(factory);
    const legacy = legacyDocument();
    await seedRawRow(factory, {
      id: legacy.id,
      document: legacy,
      meta: {
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        revision: 1,
      },
    });

    await repo.recoverStoredProjects();
    const [entry] = await repo.listRecovery();

    const restored = await repo.restoreRecovery(entry.id, { asCopy: true });
    expect(restored.document.schemaVersion).toBe(2);
    expect(restored.document.id).not.toBe(legacy.id);

    repo.close();
  });

  it("quarantines a corrupt row and keeps the rest of the workspace openable", async () => {
    const factory = new IDBFactory();
    const repo = await open(factory);

    const healthy = await repo.save(sampleProjectDocument());
    await seedRawRow(factory, {
      id: "p-corrupt",
      document: {
        schemaVersion: 2,
        id: "p-corrupt",
        name: "Corrupt",
        snapshots: "not-an-array",
        stories: [],
      },
      meta: {
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        revision: 1,
      },
    });

    const report = await repo.recoverStoredProjects();

    expect(report.quarantined).toHaveLength(1);
    expect(report.quarantined[0].reason).toBe("corrupt-record");

    const list = await repo.list();
    expect(list.map((entry) => entry.id)).toEqual([healthy.document.id]);
    expect(await repo.get("p-corrupt" as never)).toBeUndefined();

    const recovery = await repo.listRecovery();
    expect(recovery[0].projectName).toBe("Corrupt");

    repo.close();
  });

  it("leaves current, valid rows untouched", async () => {
    const factory = new IDBFactory();
    const repo = await open(factory);
    const sampleDoc = sampleProjectDocument();
    await repo.save(sampleDoc);

    const report = await repo.recoverStoredProjects();

    expect(report.migrated).toHaveLength(0);
    expect(report.quarantined).toHaveLength(0);
    expect((await repo.get(sampleDoc.id))?.document).toEqual(sampleDoc);
    expect(await repo.listRecovery()).toHaveLength(0);

    repo.close();
  });
});

describe("ProjectRepository backup and restore", () => {
  it("exports all projects into a bundle that restores into a fresh profile", async () => {
    const source = await open(new IDBFactory());
    const a = await source.save(sampleProjectDocument());
    const b = await source.create({ name: "Second" });

    const backup = await source.exportAllProjects();
    expect(JSON.parse(backup).format).toBe("animation-mermaid-backup");
    source.close();

    const restoredRepo = await ProjectRepository.open({
      indexedDB: new IDBFactory(),
      databaseName: crypto.randomUUID(),
    });
    const report = await restoredRepo.restoreBackup(backup);

    expect(report.restored).toEqual(
      expect.arrayContaining([a.document.id, b.document.id]),
    );
    expect(report.failed).toHaveLength(0);
    expect((await restoredRepo.list()).length).toBe(2);
    expect((await restoredRepo.get(a.document.id))?.document).toEqual(
      a.document,
    );
    restoredRepo.close();
  });

  it("skips already-present projects unless restoring as copies", async () => {
    const repo = await ProjectRepository.open({
      indexedDB: new IDBFactory(),
      databaseName: crypto.randomUUID(),
    });
    const saved = await repo.save(sampleProjectDocument());
    const backup = await repo.exportAllProjects();

    const skipReport = await repo.restoreBackup(backup);
    expect(skipReport.skipped).toEqual([saved.document.id]);
    expect((await repo.list()).length).toBe(1);

    const copyReport = await repo.restoreBackup(backup, { asCopy: true });
    expect(copyReport.restored).toHaveLength(1);
    expect((await repo.list()).length).toBe(2);
    repo.close();
  });

  it("rejects a file that is not an Animation Mermaid backup", async () => {
    const repo = await ProjectRepository.open({
      indexedDB: new IDBFactory(),
      databaseName: crypto.randomUUID(),
    });
    await expect(repo.restoreBackup("{}")).rejects.toMatchObject({
      code: "invalid-backup",
    });
    await expect(repo.restoreBackup("not json")).rejects.toMatchObject({
      code: "invalid-backup",
    });
    repo.close();
  });
});

describe("ProjectRepository write failures", () => {
  it("never resolves a save as committed once the store is unusable", async () => {
    const repo = await ProjectRepository.open({
      indexedDB: new IDBFactory(),
      databaseName: crypto.randomUUID(),
    });
    repo.close();

    const rejection = repo.save(sampleProjectDocument());
    await expect(rejection).rejects.toBeInstanceOf(RepositoryError);
    await expect(rejection).rejects.toMatchObject({ code: "write-failed" });
  });

  it("reports storage as unavailable when there is no IndexedDB", async () => {
    await expect(
      ProjectRepository.open({ indexedDB: undefined }),
    ).rejects.toMatchObject({ code: "storage-unavailable" });
  });
});
