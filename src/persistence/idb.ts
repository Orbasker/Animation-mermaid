/**
 * Minimal promise wrappers over the raw IndexedDB API. IndexedDB is event-based and its
 * transactions auto-commit as soon as their request queue drains, which makes the raw API
 * awkward to use correctly. These helpers give the persistence layer a small, dependable
 * surface: a single request as a promise, a database opened as a promise, and an atomic
 * transaction whose returned promise only settles once the transaction has *durably
 * committed* (or rolled back). That last guarantee is what lets a repository recover to the
 * last complete transaction after an interrupted write — a partially applied transaction is
 * always rolled back by IndexedDB, never observed.
 */

/** Resolves with a request's result on success, rejects with its error on failure. */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Callback that upgrades a database's schema. Runs inside the `versionchange` transaction,
 * so it may create/delete object stores and indexes synchronously.
 */
export type UpgradeDatabase = (
  database: IDBDatabase,
  oldVersion: number,
  transaction: IDBTransaction,
) => void;

/** Opens (creating or upgrading as needed) a database and resolves with the connection. */
export function openDatabase(
  factory: IDBFactory,
  name: string,
  version: number,
  upgrade: UpgradeDatabase,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion, request.transaction!);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new DOMException(
          `Opening database "${name}" is blocked by another connection.`,
          "InvalidStateError",
        ),
      );
  });
}

/**
 * Runs `work` inside a single transaction and resolves with its value **only after the
 * transaction has committed**. `work` is invoked synchronously so its first IndexedDB
 * request is issued before the (empty) transaction can auto-commit; within it, only
 * IndexedDB request promises should be awaited — awaiting anything else (a timer, a fetch)
 * lets the transaction go inactive and later requests will throw. If `work` throws or
 * rejects, the transaction is aborted and every write it made is rolled back, so callers
 * that observe a rejection can trust that nothing was partially persisted.
 */
export function runTransaction<T>(
  database: IDBDatabase,
  storeNames: string | readonly string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeNames as string | string[], mode);

    let result: T;
    let workFailed = false;
    let failure: unknown;

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () =>
      reject(workFailed ? failure : transaction.error);
    transaction.onabort = () =>
      reject(
        workFailed
          ? failure
          : (transaction.error ??
            new DOMException("Transaction aborted.", "AbortError")),
      );

    let output: Promise<T> | T;
    try {
      output = work(transaction);
    } catch (error) {
      workFailed = true;
      failure = error;
      transaction.abort();
      return;
    }

    Promise.resolve(output)
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        workFailed = true;
        failure = error;
        try {
          transaction.abort();
        } catch {
          // Transaction may have already finished; the reject below still fires.
        }
        reject(error);
      });
  });
}
