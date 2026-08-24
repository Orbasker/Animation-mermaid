/**
 * Startup and save-time probe of the browser's local storage. A local-first product keeps
 * everything in IndexedDB, so before the editor trusts autosave it needs to know whether
 * IndexedDB is actually usable, whether the data is durable (persisted vs. evictable), and
 * how much headroom is left. The probe is deliberately side-effect-light — it opens a tiny
 * throwaway database and does one round-trip — and every ambient dependency is injectable so
 * it can be exercised deterministically in tests.
 */

/**
 * Coarse health classification the UI can branch on:
 * - `ok`: IndexedDB works and storage is persistent with healthy headroom.
 * - `degraded`: IndexedDB works, but data is evictable (not persisted) or quota is low — a
 *   good moment to recommend a backup without alarming the user.
 * - `blocked`: IndexedDB exists but could not be opened (private browsing, disabled storage,
 *   or a blocking upgrade). Editing is possible in memory but nothing will be saved.
 * - `unsupported`: no IndexedDB at all.
 */
export type StorageHealthStatus = "ok" | "degraded" | "blocked" | "unsupported";

export interface StorageHealth {
  readonly status: StorageHealthStatus;
  /** Whether IndexedDB could be opened and written for a probe round-trip. */
  readonly available: boolean;
  /** Whether the origin's storage is persisted (won't be evicted under pressure). */
  readonly persistent: boolean;
  /** Estimated bytes in use, when the browser exposes `navigator.storage.estimate`. */
  readonly usageBytes: number | null;
  /** Estimated quota in bytes, when exposed. */
  readonly quotaBytes: number | null;
  /** Short human-facing headline for a status banner. */
  readonly title: string;
  /** One-sentence explanation with the recommended next action. */
  readonly detail: string;
  /** Whether the UI should nudge the user to keep a JSON backup. */
  readonly recommendBackup: boolean;
}

/** Minimal slice of `navigator.storage` the probe uses; all methods are optional. */
export interface StorageManagerLike {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export interface StorageHealthProbeOptions {
  /** IndexedDB implementation to probe; defaults to `globalThis.indexedDB`. */
  readonly indexedDB?: IDBFactory | null;
  /**
   * Storage manager used to read persistence and quota; defaults to
   * `globalThis.navigator?.storage`. Pass `null` to skip persistence/quota entirely.
   */
  readonly storage?: StorageManagerLike | null;
  /** Name of the throwaway probe database. */
  readonly databaseName?: string;
  /** Whether to request persistence when it is not already granted. Defaults to `true`. */
  readonly requestPersistence?: boolean;
  /** Below this many free bytes, a working store is still reported as `degraded`. */
  readonly lowHeadroomBytes?: number;
}

const PROBE_DATABASE = "animation-mermaid-probe";
const PROBE_STORE = "probe";
/** 5 MB: enough headroom that an ordinary project save is very unlikely to hit quota. */
const DEFAULT_LOW_HEADROOM_BYTES = 5 * 1024 * 1024;

function resolveIndexedDB(
  option: StorageHealthProbeOptions["indexedDB"],
): IDBFactory | null {
  if (option !== undefined) return option;
  return typeof globalThis.indexedDB === "undefined"
    ? null
    : globalThis.indexedDB;
}

function resolveStorage(
  option: StorageHealthProbeOptions["storage"],
): StorageManagerLike | null {
  if (option !== undefined) return option;
  const storage = globalThis.navigator?.storage as
    StorageManagerLike | undefined;
  return storage ?? null;
}

/** Opens the probe database, writes one value, and reads it back, resolving `true` on success. */
function probeRoundTrip(
  factory: IDBFactory,
  databaseName: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(databaseName, 1);
    } catch {
      resolve(false);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROBE_STORE)) {
        db.createObjectStore(PROBE_STORE);
      }
    };
    request.onblocked = () => resolve(false);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(PROBE_STORE, "readwrite");
        const store = tx.objectStore(PROBE_STORE);
        store.put(1, "probe");
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
        tx.onabort = () => {
          db.close();
          resolve(false);
        };
      } catch {
        db.close();
        resolve(false);
      }
    };
  });
}

async function readPersistence(
  storage: StorageManagerLike | null,
  requestPersistence: boolean,
): Promise<boolean> {
  if (!storage?.persisted) return false;
  try {
    if (await storage.persisted()) return true;
    if (requestPersistence && storage.persist) {
      return await storage.persist();
    }
  } catch {
    // Persistence APIs are best-effort; treat any failure as "not persistent".
  }
  return false;
}

async function readEstimate(
  storage: StorageManagerLike | null,
): Promise<{ usageBytes: number | null; quotaBytes: number | null }> {
  if (!storage?.estimate) return { usageBytes: null, quotaBytes: null };
  try {
    const estimate = await storage.estimate();
    return {
      usageBytes: typeof estimate.usage === "number" ? estimate.usage : null,
      quotaBytes: typeof estimate.quota === "number" ? estimate.quota : null,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null };
  }
}

const UNSUPPORTED: StorageHealth = {
  status: "unsupported",
  available: false,
  persistent: false,
  usageBytes: null,
  quotaBytes: null,
  title: "This browser can't save projects locally",
  detail:
    "IndexedDB isn't available here, so your work stays only in this tab. Export a JSON backup to keep it, and reopen in a browser with local storage enabled.",
  recommendBackup: true,
};

const BLOCKED: StorageHealth = {
  status: "blocked",
  available: false,
  persistent: false,
  usageBytes: null,
  quotaBytes: null,
  title: "Local saving is unavailable",
  detail:
    "Local storage couldn't be opened — this often happens in private/incognito windows or when site data is blocked. You can keep editing, but export a JSON backup to avoid losing changes.",
  recommendBackup: true,
};

/**
 * Probes storage health. Never throws: any failure to open or measure storage collapses into
 * a `blocked`/`unsupported`/`degraded` result with an actionable message, so callers can
 * render a banner without their own error handling.
 */
export async function probeStorageHealth(
  options: StorageHealthProbeOptions = {},
): Promise<StorageHealth> {
  const factory = resolveIndexedDB(options.indexedDB);
  if (!factory) return UNSUPPORTED;

  const available = await probeRoundTrip(
    factory,
    options.databaseName ?? PROBE_DATABASE,
  );
  if (!available) return BLOCKED;

  const storage = resolveStorage(options.storage);
  const [persistent, { usageBytes, quotaBytes }] = await Promise.all([
    readPersistence(storage, options.requestPersistence ?? true),
    readEstimate(storage),
  ]);

  const lowHeadroom = options.lowHeadroomBytes ?? DEFAULT_LOW_HEADROOM_BYTES;
  const freeBytes =
    usageBytes !== null && quotaBytes !== null ? quotaBytes - usageBytes : null;
  const quotaLow = freeBytes !== null && freeBytes < lowHeadroom;

  if (quotaLow) {
    return {
      status: "degraded",
      available: true,
      persistent,
      usageBytes,
      quotaBytes,
      title: "Local storage is almost full",
      detail:
        "There's little room left for new saves. Export a JSON backup, then delete projects you no longer need to free space.",
      recommendBackup: true,
    };
  }

  if (!persistent) {
    return {
      status: "degraded",
      available: true,
      persistent,
      usageBytes,
      quotaBytes,
      title: "Saved locally, but data can be cleared",
      detail:
        "Your work autosaves to this browser, which may evict it under storage pressure or when you clear site data. Export a JSON backup now and then for safekeeping.",
      recommendBackup: true,
    };
  }

  return {
    status: "ok",
    available: true,
    persistent,
    usageBytes,
    quotaBytes,
    title: "Saving locally",
    detail:
      "Your work autosaves to this browser and is marked persistent. Browser data can still be cleared manually, so keep the occasional JSON backup.",
    recommendBackup: false,
  };
}
