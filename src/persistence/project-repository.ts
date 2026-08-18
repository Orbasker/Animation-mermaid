import {
  createProjectDocument,
  projectId,
  validateProjectDocument,
  type ProjectDocument,
  type ProjectId,
} from "@/domain/project-document";
import {
  parseProjectDocument,
  serializeProjectDocument,
} from "@/domain/serialization";
import {
  openDatabase,
  promisifyRequest,
  runTransaction,
} from "@/persistence/idb";

const DATABASE_NAME = "animation-mermaid";
const DATABASE_VERSION = 1;
const PROJECTS_STORE = "projects";
const AI_RUNS_STORE = "aiRuns";

/**
 * Repository bookkeeping kept alongside — but deliberately outside of — the canonical
 * {@link ProjectDocument}. None of this is part of the portable JSON: it is local-only
 * metadata the repository maintains so a project list can be shown without opening every
 * document.
 */
export interface ProjectMeta {
  /** ISO-8601 timestamp of the first save. */
  readonly createdAt: string;
  /** ISO-8601 timestamp of the most recent committed save. */
  readonly updatedAt: string;
  /** ISO-8601 timestamp when the project was archived, or `null` while active. */
  readonly archivedAt: string | null;
  /** Monotonic counter incremented on every committed write. */
  readonly revision: number;
}

/** A stored project: its canonical document plus the repository's local metadata. */
export interface StoredProject {
  readonly document: ProjectDocument;
  readonly meta: ProjectMeta;
}

/** Lightweight summary returned by {@link ProjectRepository.list}. */
export interface ProjectListEntry {
  readonly id: ProjectId;
  readonly name: string;
  readonly meta: ProjectMeta;
}

/**
 * A reference to a hosted AI run. These identifiers are produced by hosted services and are
 * kept in a separate object store, never merged into the {@link ProjectDocument}, so that
 * canonical project content stays local-first and portable — exporting a project never
 * leaks a run id, and importing one never carries hosted state.
 */
export interface AiRunReference {
  readonly runId: string;
  readonly provider: string;
  /** ISO-8601 timestamp of when the run was linked. */
  readonly createdAt: string;
  readonly status?: string;
}

/** The row shape persisted in the `projects` object store (keyed by top-level `id`). */
interface ProjectRow {
  readonly id: ProjectId;
  readonly document: ProjectDocument;
  readonly meta: ProjectMeta;
}

/** The row shape persisted in the `aiRuns` object store (keyed by `projectId`). */
interface AiRunsRow {
  readonly projectId: ProjectId;
  readonly runs: readonly AiRunReference[];
}

export type RepositoryErrorCode =
  | "not-found"
  | "already-exists"
  | "invalid-import";

/** A typed failure so callers can branch on the cause without matching message strings. */
export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryError";
    this.code = code;
  }
}

export interface ProjectRepositoryOptions {
  /** IndexedDB implementation to use; defaults to the ambient `globalThis.indexedDB`. */
  readonly indexedDB?: IDBFactory;
  /** Database name; overridable so tests (and multiple profiles) stay isolated. */
  readonly databaseName?: string;
  /** Supplies the current time as an ISO-8601 string; injectable for deterministic tests. */
  readonly now?: () => string;
  /** Generates a fresh unique id; injectable for deterministic tests. */
  readonly newId?: () => string;
}

/**
 * Local-first project store backed by IndexedDB. All persistence happens on the device: no
 * project document is ever uploaded during ordinary editing. Writes go through
 * {@link runTransaction}, so an interrupted write is rolled back and the store recovers to
 * the last complete transaction. Hosted AI run identifiers live in a separate object store
 * and are excluded from the canonical document, keeping exports clean and portable.
 */
export class ProjectRepository {
  private constructor(
    private readonly database: IDBDatabase,
    private readonly now: () => string,
    private readonly newId: () => string,
  ) {}

  /** Opens the repository, creating or upgrading the underlying database as needed. */
  static async open(
    options: ProjectRepositoryOptions = {},
  ): Promise<ProjectRepository> {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new Error("No IndexedDB implementation available.");
    }
    const now = options.now ?? (() => new Date().toISOString());
    const newId = options.newId ?? (() => crypto.randomUUID());

    const database = await openDatabase(
      factory,
      options.databaseName ?? DATABASE_NAME,
      DATABASE_VERSION,
      (db) => {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(AI_RUNS_STORE)) {
          db.createObjectStore(AI_RUNS_STORE, { keyPath: "projectId" });
        }
      },
    );

    return new ProjectRepository(database, now, newId);
  }

  /** Closes the underlying database connection. */
  close(): void {
    this.database.close();
  }

  /**
   * Lists stored projects, newest update first. Archived projects are excluded unless
   * `includeArchived` is set, so an ordinary project list never shows them.
   */
  async list(
    options: { readonly includeArchived?: boolean } = {},
  ): Promise<readonly ProjectListEntry[]> {
    const rows = await runTransaction(
      this.database,
      PROJECTS_STORE,
      "readonly",
      (transaction) =>
        promisifyRequest(
          transaction.objectStore(PROJECTS_STORE).getAll() as IDBRequest<
            ProjectRow[]
          >,
        ),
    );

    return rows
      .filter((row) => options.includeArchived || row.meta.archivedAt === null)
      .sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt))
      .map((row) => ({ id: row.id, name: row.document.name, meta: row.meta }));
  }

  /** Reads a single stored project, or `undefined` when it does not exist. */
  async get(id: ProjectId): Promise<StoredProject | undefined> {
    const row = await this.readRow(id);
    return row ? { document: row.document, meta: row.meta } : undefined;
  }

  /** Creates a new, empty project with a freshly generated id. */
  async create(input: { readonly name: string }): Promise<StoredProject> {
    const document = createProjectDocument({
      id: projectId(this.newId()),
      name: input.name,
    });
    return this.insert(document);
  }

  /**
   * Persists a project document, transactionally. This is the autosave entry point: if the
   * project already exists its `createdAt` is preserved and `revision` is bumped; otherwise
   * a new row is created. The write either commits in full or is rolled back — a reload
   * after an interrupted save restores the last complete transaction.
   */
  async save(document: ProjectDocument): Promise<StoredProject> {
    const timestamp = this.now();
    return runTransaction(
      this.database,
      PROJECTS_STORE,
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore(PROJECTS_STORE);
        const existing = await promisifyRequest(
          store.get(document.id) as IDBRequest<ProjectRow | undefined>,
        );
        const meta: ProjectMeta = existing
          ? {
              createdAt: existing.meta.createdAt,
              updatedAt: timestamp,
              archivedAt: existing.meta.archivedAt,
              revision: existing.meta.revision + 1,
            }
          : {
              createdAt: timestamp,
              updatedAt: timestamp,
              archivedAt: null,
              revision: 1,
            };
        const row: ProjectRow = { id: document.id, document, meta };
        await promisifyRequest(store.put(row));
        return { document: row.document, meta: row.meta };
      },
    );
  }

  /** Renames a project. Throws {@link RepositoryError} `not-found` if it does not exist. */
  async rename(id: ProjectId, name: string): Promise<StoredProject> {
    return this.mutate(id, (row) => ({
      ...row,
      document: { ...row.document, name },
    }));
  }

  /**
   * Duplicates a project into a new one with a fresh project id and a "Copy of …" name. The
   * document's internal ids (snapshots, stories, comparisons) are preserved because they are
   * internal references within the copy; only the top-level project identity is new.
   */
  async duplicate(id: ProjectId): Promise<StoredProject> {
    const source = await this.readRow(id);
    if (!source) {
      throw new RepositoryError("not-found", `No project with id "${id}".`);
    }
    const copy: ProjectDocument = {
      ...source.document,
      id: projectId(this.newId()),
      name: `Copy of ${source.document.name}`,
    };
    return this.insert(copy);
  }

  /** Marks a project archived so it drops out of the default list. Idempotent. */
  async archive(id: ProjectId): Promise<StoredProject> {
    const timestamp = this.now();
    return this.mutate(id, (row) => ({
      ...row,
      meta: { ...row.meta, archivedAt: row.meta.archivedAt ?? timestamp },
    }));
  }

  /** Restores an archived project to the active list. Idempotent. */
  async unarchive(id: ProjectId): Promise<StoredProject> {
    return this.mutate(id, (row) => ({
      ...row,
      meta: { ...row.meta, archivedAt: null },
    }));
  }

  /** Permanently deletes a project and any AI run references linked to it. */
  async delete(id: ProjectId): Promise<void> {
    await runTransaction(
      this.database,
      [PROJECTS_STORE, AI_RUNS_STORE],
      "readwrite",
      async (transaction) => {
        await promisifyRequest(
          transaction.objectStore(PROJECTS_STORE).delete(id),
        );
        await promisifyRequest(
          transaction.objectStore(AI_RUNS_STORE).delete(id),
        );
      },
    );
  }

  /**
   * Serializes a project to portable JSON. The output is the canonical document only —
   * repository metadata and hosted AI run identifiers are excluded — so it imports cleanly
   * into a fresh browser profile.
   */
  async export(id: ProjectId): Promise<string> {
    const row = await this.readRow(id);
    if (!row) {
      throw new RepositoryError("not-found", `No project with id "${id}".`);
    }
    return serializeProjectDocument(row.document);
  }

  /**
   * Imports portable JSON as a new stored project. The payload is migrated forward to the
   * current schema version and validated for referential integrity before anything is
   * written; an invalid payload or an unsupported/future schema version fails safely with a
   * {@link RepositoryError} `invalid-import` and leaves the store untouched. By default the
   * document's own id is preserved (so an export round-trips into a fresh profile); pass
   * `asCopy` to assign a fresh id and avoid colliding with an existing project.
   */
  async import(
    json: string,
    options: { readonly asCopy?: boolean } = {},
  ): Promise<StoredProject> {
    let document: ProjectDocument;
    try {
      document = parseProjectDocument(json);
    } catch (error) {
      throw new RepositoryError(
        "invalid-import",
        `Cannot import project: ${(error as Error).message}`,
        { cause: error },
      );
    }

    const errors = validateProjectDocument(document);
    if (errors.length > 0) {
      throw new RepositoryError(
        "invalid-import",
        `Cannot import project: ${errors.length} validation error(s), first: ${errors[0].message}`,
      );
    }

    const target: ProjectDocument = options.asCopy
      ? { ...document, id: projectId(this.newId()) }
      : document;

    const existing = await this.readRow(target.id);
    if (existing) {
      throw new RepositoryError(
        "already-exists",
        `A project with id "${target.id}" already exists; import with asCopy to duplicate it.`,
      );
    }
    return this.insert(target);
  }

  /**
   * Links a hosted AI run identifier to a project without touching the project document.
   * Run references are stored separately, so ordinary editing never uploads or embeds them.
   */
  async linkAiRun(id: ProjectId, run: AiRunReference): Promise<void> {
    const project = await this.readRow(id);
    if (!project) {
      throw new RepositoryError("not-found", `No project with id "${id}".`);
    }
    await runTransaction(
      this.database,
      AI_RUNS_STORE,
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore(AI_RUNS_STORE);
        const current = await promisifyRequest(
          store.get(id) as IDBRequest<AiRunsRow | undefined>,
        );
        const runs = [...(current?.runs ?? []), run];
        await promisifyRequest(store.put({ projectId: id, runs }));
      },
    );
  }

  /** Returns the hosted AI run references linked to a project, in link order. */
  async aiRuns(id: ProjectId): Promise<readonly AiRunReference[]> {
    const row = await runTransaction(
      this.database,
      AI_RUNS_STORE,
      "readonly",
      (transaction) =>
        promisifyRequest(
          transaction.objectStore(AI_RUNS_STORE).get(id) as IDBRequest<
            AiRunsRow | undefined
          >,
        ),
    );
    return row?.runs ?? [];
  }

  private async readRow(id: ProjectId): Promise<ProjectRow | undefined> {
    return runTransaction(
      this.database,
      PROJECTS_STORE,
      "readonly",
      (transaction) =>
        promisifyRequest(
          transaction.objectStore(PROJECTS_STORE).get(id) as IDBRequest<
            ProjectRow | undefined
          >,
        ),
    );
  }

  private async insert(document: ProjectDocument): Promise<StoredProject> {
    const timestamp = this.now();
    const meta: ProjectMeta = {
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      revision: 1,
    };
    const row: ProjectRow = { id: document.id, document, meta };
    await runTransaction(
      this.database,
      PROJECTS_STORE,
      "readwrite",
      (transaction) =>
        promisifyRequest(transaction.objectStore(PROJECTS_STORE).add(row)),
    );
    return { document: row.document, meta: row.meta };
  }

  private async mutate(
    id: ProjectId,
    change: (row: ProjectRow) => ProjectRow,
  ): Promise<StoredProject> {
    return runTransaction(
      this.database,
      PROJECTS_STORE,
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore(PROJECTS_STORE);
        const existing = await promisifyRequest(
          store.get(id) as IDBRequest<ProjectRow | undefined>,
        );
        if (!existing) {
          throw new RepositoryError("not-found", `No project with id "${id}".`);
        }
        const next = change(existing);
        await promisifyRequest(store.put(next));
        return { document: next.document, meta: next.meta };
      },
    );
  }
}
