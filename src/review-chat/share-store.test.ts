import { createMemoryState } from "@chat-adapter/state-memory";
import { describe, expect, it } from "vitest";

import { buildAgentContextPackage } from "@/domain/agent-context";
import { currentArchitectureSnapshot } from "@/domain/fixtures";

import {
  createStateBackedShareStore,
  InvalidReviewPackageError,
  shareIdFor,
} from "./share-store";

function samplePackage() {
  return buildAgentContextPackage({
    intent: "Review the current architecture",
    snapshot: currentArchitectureSnapshot(),
  });
}

describe("createStateBackedShareStore", () => {
  it("shares a valid package and resolves it by id", async () => {
    const store = createStateBackedShareStore(createMemoryState());
    const pkg = samplePackage();

    const shareId = await store.share(pkg);
    expect(shareId).toBe(shareIdFor(pkg));

    const resolved = await store.get(shareId);
    expect(resolved?.intent).toBe(pkg.intent);
    expect(resolved?.graph.entities.length).toBe(pkg.graph.entities.length);
  });

  it("is idempotent: sharing the same package twice yields one id", async () => {
    const state = createMemoryState();
    const store = createStateBackedShareStore(state);
    const pkg = samplePackage();

    const first = await store.share(pkg);
    const second = await store.share(pkg);
    expect(second).toBe(first);
  });

  it("rejects a package that is not a valid agent context", async () => {
    const store = createStateBackedShareStore(createMemoryState());

    await expect(store.share({ intent: "", graph: { entities: [] } })).rejects.toBeInstanceOf(
      InvalidReviewPackageError,
    );
  });

  it("rejects a package carrying layout or renderer data", async () => {
    const store = createStateBackedShareStore(createMemoryState());
    const leaky = { ...samplePackage(), layout: { x: 1, y: 2 } };

    await expect(store.share(leaky)).rejects.toBeInstanceOf(InvalidReviewPackageError);
  });

  it("returns null for an id that was never shared (access is share-gated)", async () => {
    const store = createStateBackedShareStore(createMemoryState());
    expect(await store.get(`rev_${"0".repeat(32)}`)).toBeNull();
  });

  it("resolves a share written to the same backend by a different store instance", async () => {
    const state = createMemoryState();
    const pkg = samplePackage();

    const shareId = await createStateBackedShareStore(state).share(pkg);
    // A fresh store over the same durable backend — the shape a redeploy takes.
    const rebuilt = createStateBackedShareStore(state);
    expect((await rebuilt.get(shareId))?.intent).toBe(pkg.intent);
  });
});
