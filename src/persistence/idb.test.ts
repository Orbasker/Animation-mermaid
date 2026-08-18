import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";

import {
  openDatabase,
  promisifyRequest,
  runTransaction,
} from "@/persistence/idb";

const STORE = "values";

async function openTestDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return openDatabase(factory, "idb-test", 1, (db) => {
    db.createObjectStore(STORE);
  });
}

function read(database: IDBDatabase, key: string): Promise<unknown> {
  return runTransaction(database, STORE, "readonly", (transaction) =>
    promisifyRequest(transaction.objectStore(STORE).get(key)),
  );
}

describe("runTransaction", () => {
  let factory: IDBFactory;
  let database: IDBDatabase;

  beforeEach(async () => {
    factory = new IDBFactory();
    database = await openTestDatabase(factory);
  });

  it("commits writes and resolves with the work's value", async () => {
    const written = await runTransaction(
      database,
      STORE,
      "readwrite",
      async (transaction) => {
        await promisifyRequest(transaction.objectStore(STORE).put("v1", "key"));
        return "done";
      },
    );

    expect(written).toBe("done");
    expect(await read(database, "key")).toBe("v1");
  });

  it("rolls back an interrupted write to the last complete transaction", async () => {
    await runTransaction(database, STORE, "readwrite", (transaction) =>
      promisifyRequest(transaction.objectStore(STORE).put("v1", "key")),
    );

    await expect(
      runTransaction(database, STORE, "readwrite", async (transaction) => {
        await promisifyRequest(transaction.objectStore(STORE).put("v2", "key"));
        throw new Error("interrupted mid-write");
      }),
    ).rejects.toThrow("interrupted mid-write");

    expect(await read(database, "key")).toBe("v1");
  });

  it("rejects and rolls back when the transaction is aborted", async () => {
    await runTransaction(database, STORE, "readwrite", (transaction) =>
      promisifyRequest(transaction.objectStore(STORE).put("v1", "key")),
    );

    await expect(
      runTransaction(database, STORE, "readwrite", (transaction) => {
        transaction.objectStore(STORE).put("v2", "key");
        transaction.abort();
      }),
    ).rejects.toBeDefined();

    expect(await read(database, "key")).toBe("v1");
  });
});
