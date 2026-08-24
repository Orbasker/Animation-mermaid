import {
  createProjectDocument,
  projectId,
  validateProjectDocument,
  type ProjectDocument,
  type ProjectId,
} from "@/domain/project-document";
import { CURRENT_SCHEMA_VERSION } from "@/domain/schema-version";
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
const DATABASE_VERSION = 2;
const PROJECTS_STORE = "projects";
const RECOVERY_STORE = "recovery";

/** Marker identifying a full multi-project backup bundle. */
export const BACKUP_FORMAT = "animation-mermaid-backup";
const BACKUP_VERSION = 1;

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

/** The row shape persisted in the `projects` object store (keyed by top-level `id`). */
interface ProjectRow {
  readonly id: ProjectId;
  readonly document: ProjectDocument;
  readonly meta: ProjectMeta;
}

export type RepositoryErrorCode =
  | "not-found"
  | "already-exists"
  | "invalid-import"
  | "invalid-backup"
  | "quota-exceeded"
  | "blocked"
  | "storage-unavailable"
  | "write-failed";

/** A typed failure so callers can branch on the cause without matching message strings. */
export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(
    code: RepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryError";
    this.code = code;
  }
}

/**
 * Translates a raw IndexedDB write failure into a typed {@link RepositoryError} the UI can act
 * on. A {@link RepositoryError} is passed through unchanged; a `QuotaExceededError` becomes a
 * `quota-exceeded` error with a clear next action, and anything else becomes `write-failed`.
 * Because a failed write always rejects (it never resolves), callers can trust that a resolved
 * save is a committed save — a false "saved" state is impossible.
 */
function mapWriteError(error: unknown): RepositoryError {
  if (error instanceof RepositoryError) return error;
  const name = (error as { name?: string } | null)?.name;
  const message = error instanceof Error ? error.message : String(error);
  if (name === "QuotaExceededError") {
    return new RepositoryError(
      "quota-exceeded",
      "Local storage is full. Export a JSON backup, then delete projects you no longer need to free space.",
      { cause: error },
    );
  }
  return new RepositoryError(
    "write-failed",
    `The write could not be completed: ${message}`,
    { cause: error },
  );
}

/** Why a pre-migration or corrupt row was copied into the recovery store. */
export type RecoveryReason = "pre-migration" | "corrupt-record";

/** A recoverable copy of a stored row, preserved before migration or after corruption. */
export interface RecoveryEntry {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly projectName: string | null;
  readonly reason: RecoveryReason;
  /** ISO-8601 timestamp of when the snapshot was captured. */
  readonly createdAt: string;
  /** The pre-migration schema version, when it could be read. */
  readonly fromSchemaVersion: number | null;
  /** The original document as a JSON string, exactly as it was stored. */
  readonly raw: string;
}

/** Outcome of {@link ProjectRepository.recoverStoredProjects}. */
export interface RecoveryReport {
  /** Projects migrated forward to the current schema version. */
  readonly migrated: readonly ProjectId[];
  /** Rows that could not be decoded and were quarantined into the recovery store. */
  readonly quarantined: readonly RecoveryEntry[];
}

/** A portable, multi-project backup produced by {@link ProjectRepository.exportAllProjects}. */
export interface ProjectBackup {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: typeof BACKUP_VERSION;
  /** ISO-8601 timestamp of when the backup was written. */
  readonly exportedAt: string;
  readonly projects: readonly ProjectDocument[];
}

/** Per-project outcome of restoring a backup or recovery snapshot. */
export interface RestoreReport {
  readonly restored: readonly ProjectId[];
  /** Projects skipped because they already exist and `asCopy` was not requested. */
  readonly skipped: readonly ProjectId[];
  /** Projects that failed to restore, with the reason. */
  readonly failed: readonly {
    readonly name: string;
    readonly message: string;
  }[];
}

/** The row shape persisted in the `recovery` object store (keyed by `id`). */
type RecoveryRow = RecoveryEntry;

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
 * the last complete transaction.
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
      throw new RepositoryError(
        "storage-unavailable",
        "No IndexedDB implementation available. This browser can't save projects locally.",
      );
    }
    const now = options.now ?? (() => new Date().toISOString());
    const newId = options.newId ?? (() => crypto.randomUUID());

    let database: IDBDatabase;
    try {
      database = await openDatabase(
        factory,
        options.databaseName ?? DATABASE_NAME,
        DATABASE_VERSION,
        (db) => {
          if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
            db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
            db.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
          }
        },
      );
    } catch (error) {
      // A blocking upgrade (another tab holds an older-version connection) is the common,
      // recoverable case — surface it typed so the UI can tell the user to close other tabs.
      if ((error as { name?: string } | null)?.name === "InvalidStateError") {
        throw new RepositoryError(
          "blocked",
          "Local storage is blocked by another open tab. Close the app's other tabs and reload.",
          { cause: error },
        );
      }
      throw error;
    }

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
      .filter(
        (row): row is ProjectRow =>
          Boolean(row?.meta) && Boolean(row?.document),
      )
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
    return this.guardWrite(() =>
      runTransaction(
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
      ),
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

  /** Permanently deletes a project. */
  async delete(id: ProjectId): Promise<void> {
    await this.guardWrite(() =>
      runTransaction(
        this.database,
        PROJECTS_STORE,
        "readwrite",
        (transaction) =>
          promisifyRequest(transaction.objectStore(PROJECTS_STORE).delete(id)),
      ),
    );
  }

  /**
   * Serializes a project to portable JSON. The output is the canonical document only —
   * repository metadata is excluded — so it imports cleanly into a fresh browser profile.
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
   * Startup recovery pass. Scans every stored row and, for each one whose document is at an
   * older schema version, copies the original into the recovery store **before** migrating it
   * forward — so a migration that later proves lossy or wrong is never destructive. Rows that
   * cannot be decoded at all (corrupt records, evicted-and-partially-written data, or an
   * unsupported future version) are copied into the recovery store and removed from the active
   * list, so a single bad row never blocks opening the rest of the workspace. Rows already at
   * the current version are left untouched. Safe to call on every startup.
   */
  async recoverStoredProjects(): Promise<RecoveryReport> {
    const rawRows = await runTransaction(
      this.database,
      PROJECTS_STORE,
      "readonly",
      (transaction) =>
        promisifyRequest(
          transaction.objectStore(PROJECTS_STORE).getAll() as IDBRequest<
            unknown[]
          >,
        ),
    );

    const migrated: ProjectId[] = [];
    const quarantined: RecoveryEntry[] = [];

    for (const raw of rawRows) {
      const row = raw as Partial<ProjectRow> | null;
      const document = row?.document as
        (ProjectDocument & Record<string, unknown>) | undefined;
      const version =
        typeof document?.schemaVersion === "number"
          ? document.schemaVersion
          : null;

      try {
        const parsed = parseProjectDocument(JSON.stringify(document ?? raw));
        if (version === CURRENT_SCHEMA_VERSION) continue;
        // An older-but-migratable document: preserve the original, then rewrite it migrated.
        await this.captureRecovery(document ?? raw, "pre-migration");
        const meta = (row?.meta as ProjectMeta | undefined) ?? {
          createdAt: this.now(),
          updatedAt: this.now(),
          archivedAt: null,
          revision: 1,
        };
        await this.guardWrite(() =>
          runTransaction(this.database, PROJECTS_STORE, "readwrite", (tx) =>
            promisifyRequest(
              tx
                .objectStore(PROJECTS_STORE)
                .put({ id: parsed.id, document: parsed, meta }),
            ),
          ),
        );
        migrated.push(parsed.id);
      } catch {
        // Undecodable: quarantine into the recovery store and drop from the active list.
        const entry = await this.captureRecovery(
          document ?? raw,
          "corrupt-record",
        );
        quarantined.push(entry);
        const key = (row?.id ?? document?.id) as ProjectId | undefined;
        if (key !== undefined) {
          await this.guardWrite(() =>
            runTransaction(this.database, PROJECTS_STORE, "readwrite", (tx) =>
              promisifyRequest(tx.objectStore(PROJECTS_STORE).delete(key)),
            ),
          );
        }
      }
    }

    return { migrated, quarantined };
  }

  /** Lists recovery snapshots, newest first. */
  async listRecovery(): Promise<readonly RecoveryEntry[]> {
    const rows = await runTransaction(
      this.database,
      RECOVERY_STORE,
      "readonly",
      (transaction) =>
        promisifyRequest(
          transaction.objectStore(RECOVERY_STORE).getAll() as IDBRequest<
            RecoveryRow[]
          >,
        ),
    );
    return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Restores a recovery snapshot back into the active list, migrating it forward and
   * validating it first. By default the recovered project keeps its original id; pass `asCopy`
   * to restore alongside an existing project under a fresh id.
   */
  async restoreRecovery(
    id: string,
    options: { readonly asCopy?: boolean } = {},
  ): Promise<StoredProject> {
    const entry = await runTransaction(
      this.database,
      RECOVERY_STORE,
      "readonly",
      (transaction) =>
        promisifyRequest(
          transaction.objectStore(RECOVERY_STORE).get(id) as IDBRequest<
            RecoveryRow | undefined
          >,
        ),
    );
    if (!entry) {
      throw new RepositoryError("not-found", `No recovery snapshot "${id}".`);
    }
    return this.import(entry.raw, options);
  }

  /** Permanently discards a recovery snapshot. */
  async deleteRecovery(id: string): Promise<void> {
    await this.guardWrite(() =>
      runTransaction(
        this.database,
        RECOVERY_STORE,
        "readwrite",
        (transaction) =>
          promisifyRequest(transaction.objectStore(RECOVERY_STORE).delete(id)),
      ),
    );
  }

  /**
   * Serializes every stored project into a single portable backup bundle. Like {@link export},
   * the bundle carries only canonical documents — no repository metadata — so it restores
   * cleanly into a fresh browser profile.
   */
  async exportAllProjects(
    options: { readonly includeArchived?: boolean } = {},
  ): Promise<string> {
    const entries = await this.list({
      includeArchived: options.includeArchived ?? true,
    });
    const projects: ProjectDocument[] = [];
    for (const entry of entries) {
      const row = await this.readRow(entry.id);
      if (row) projects.push(row.document);
    }
    const backup: ProjectBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: this.now(),
      projects,
    };
    return JSON.stringify(backup);
  }

  /**
   * Restores projects from a backup bundle produced by {@link exportAllProjects}. Each project
   * is migrated forward and validated independently, so one malformed project never aborts the
   * whole restore. Projects that already exist are skipped unless `asCopy` is set, in which
   * case they are restored under fresh ids. The result reports exactly what happened to each.
   */
  async restoreBackup(
    json: string,
    options: { readonly asCopy?: boolean } = {},
  ): Promise<RestoreReport> {
    let bundle: unknown;
    try {
      bundle = JSON.parse(json);
    } catch (error) {
      throw new RepositoryError(
        "invalid-backup",
        `Cannot read backup: ${(error as Error).message}`,
        { cause: error },
      );
    }
    if (
      typeof bundle !== "object" ||
      bundle === null ||
      (bundle as { format?: unknown }).format !== BACKUP_FORMAT ||
      !Array.isArray((bundle as { projects?: unknown }).projects)
    ) {
      throw new RepositoryError(
        "invalid-backup",
        "Cannot read backup: this file is not an Animation Mermaid backup.",
      );
    }

    const restored: ProjectId[] = [];
    const skipped: ProjectId[] = [];
    const failed: { name: string; message: string }[] = [];
    const projects = (bundle as ProjectBackup).projects;

    for (const project of projects) {
      const name =
        (project as { name?: unknown } | null)?.name &&
        typeof (project as { name?: unknown }).name === "string"
          ? (project as { name: string }).name
          : "Untitled project";
      try {
        const stored = await this.import(JSON.stringify(project), options);
        restored.push(stored.document.id);
      } catch (error) {
        if (
          error instanceof RepositoryError &&
          error.code === "already-exists"
        ) {
          skipped.push((project as ProjectDocument).id);
        } else {
          failed.push({
            name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return { restored, skipped, failed };
  }

  /** Copies a raw stored document into the recovery store and returns the created entry. */
  private async captureRecovery(
    document: unknown,
    reason: RecoveryReason,
  ): Promise<RecoveryEntry> {
    const record = document as Record<string, unknown> | null;
    const sourceId =
      typeof record?.id === "string"
        ? (record.id as ProjectId)
        : ("unknown" as ProjectId);
    const projectName =
      typeof record?.name === "string" ? (record.name as string) : null;
    const fromSchemaVersion =
      typeof record?.schemaVersion === "number"
        ? (record.schemaVersion as number)
        : null;
    const entry: RecoveryEntry = {
      id: this.newId(),
      projectId: sourceId,
      projectName,
      reason,
      createdAt: this.now(),
      fromSchemaVersion,
      raw: JSON.stringify(document),
    };
    await this.guardWrite(() =>
      runTransaction(
        this.database,
        RECOVERY_STORE,
        "readwrite",
        (transaction) =>
          promisifyRequest(transaction.objectStore(RECOVERY_STORE).put(entry)),
      ),
    );
    return entry;
  }

  /** Runs a write and rethrows any failure as a typed {@link RepositoryError}. */
  private async guardWrite<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw mapWriteError(error);
    }
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
    await this.guardWrite(() =>
      runTransaction(
        this.database,
        PROJECTS_STORE,
        "readwrite",
        (transaction) =>
          promisifyRequest(transaction.objectStore(PROJECTS_STORE).add(row)),
      ),
    );
    return { document: row.document, meta: row.meta };
  }

  private async mutate(
    id: ProjectId,
    change: (row: ProjectRow) => ProjectRow,
  ): Promise<StoredProject> {
    return this.guardWrite(() =>
      runTransaction(
        this.database,
        PROJECTS_STORE,
        "readwrite",
        async (transaction) => {
          const store = transaction.objectStore(PROJECTS_STORE);
          const existing = await promisifyRequest(
            store.get(id) as IDBRequest<ProjectRow | undefined>,
          );
          if (!existing) {
            throw new RepositoryError(
              "not-found",
              `No project with id "${id}".`,
            );
          }
          const next = change(existing);
          await promisifyRequest(store.put(next));
          return { document: next.document, meta: next.meta };
        },
      ),
    );
  }
}
