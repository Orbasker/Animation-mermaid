import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  probeStorageHealth,
  type StorageManagerLike,
} from "@/persistence/storage-health";

const HEALTHY_STORAGE: StorageManagerLike = {
  persisted: async () => true,
  persist: async () => true,
  estimate: async () => ({ usage: 1_000, quota: 1_000_000_000 }),
};

describe("probeStorageHealth", () => {
  it("reports unsupported when there is no IndexedDB", async () => {
    const health = await probeStorageHealth({ indexedDB: null });
    expect(health.status).toBe("unsupported");
    expect(health.available).toBe(false);
    expect(health.recommendBackup).toBe(true);
  });

  it("reports blocked when the database cannot be opened", async () => {
    const throwingFactory = {
      open() {
        throw new DOMException("blocked", "InvalidStateError");
      },
    } as unknown as IDBFactory;

    const health = await probeStorageHealth({
      indexedDB: throwingFactory,
      storage: null,
    });

    expect(health.status).toBe("blocked");
    expect(health.available).toBe(false);
    expect(health.detail).toMatch(/private/i);
  });

  it("reports ok when storage works and is persistent with headroom", async () => {
    const health = await probeStorageHealth({
      indexedDB: new IDBFactory(),
      storage: HEALTHY_STORAGE,
      databaseName: crypto.randomUUID(),
    });

    expect(health.status).toBe("ok");
    expect(health.available).toBe(true);
    expect(health.persistent).toBe(true);
    expect(health.quotaBytes).toBe(1_000_000_000);
    expect(health.recommendBackup).toBe(false);
  });

  it("reports degraded when storage is not persistent", async () => {
    const health = await probeStorageHealth({
      indexedDB: new IDBFactory(),
      storage: {
        persisted: async () => false,
        persist: async () => false,
        estimate: async () => ({ usage: 1, quota: 1_000_000_000 }),
      },
      databaseName: crypto.randomUUID(),
    });

    expect(health.status).toBe("degraded");
    expect(health.available).toBe(true);
    expect(health.persistent).toBe(false);
    expect(health.recommendBackup).toBe(true);
  });

  it("reports degraded when quota headroom is low", async () => {
    const health = await probeStorageHealth({
      indexedDB: new IDBFactory(),
      storage: {
        persisted: async () => true,
        estimate: async () => ({ usage: 999_000, quota: 1_000_000 }),
      },
      databaseName: crypto.randomUUID(),
      lowHeadroomBytes: 5_000_000,
    });

    expect(health.status).toBe("degraded");
    expect(health.title).toMatch(/almost full/i);
  });

  it("requests persistence when it is not yet granted", async () => {
    let requested = false;
    const health = await probeStorageHealth({
      indexedDB: new IDBFactory(),
      storage: {
        persisted: async () => false,
        persist: async () => {
          requested = true;
          return true;
        },
        estimate: async () => ({ usage: 1, quota: 1_000_000_000 }),
      },
      databaseName: crypto.randomUUID(),
    });

    expect(requested).toBe(true);
    expect(health.persistent).toBe(true);
    expect(health.status).toBe("ok");
  });
});
