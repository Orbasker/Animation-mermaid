import { describe, expect, it } from "vitest";

import {
  buildCompareSnapshot,
  buildOverlayView,
  buildSideBySideView,
  changesToCompareStory,
  diffArchitectures,
  filterChanges,
  matchEntities,
  recordEntityId,
  type ArchitectureDiff,
  type ChangeCategory,
} from "@/domain/semantic-compare";
import {
  confirmIdentity,
  EMPTY_IDENTITY_MAP,
  rejectIdentity,
} from "@/domain/identity-map";
import {
  createGraphSnapshot,
  entityId,
  snapshotId,
  validateGraphSnapshot,
  type GraphEntity,
  type GraphSnapshot,
} from "@/domain/graph";
import { storyId, validateStory } from "@/domain/story";
import {
  currentArchitectureSnapshot,
  proposedArchitectureSnapshot,
} from "@/domain/fixtures";

const SOURCE = {
  diagramType: "flowchart",
  text: "flowchart TD",
  importer: {
    importer: "mermaid-flowchart",
    importerVersion: "0.1.0",
    importedAt: "2026-08-18T00:00:00.000Z",
  },
} as const;

function snapshot(id: string, entities: GraphEntity[]): GraphSnapshot {
  return createGraphSnapshot({ id: snapshotId(id), source: SOURCE, entities });
}

function categoryOf(diff: ArchitectureDiff, id: string): ChangeCategory[] {
  return diff.records
    .filter((record) => recordEntityId(record) === entityId(id))
    .map((record) => record.category);
}

describe("diffArchitectures — semantic-key matching", () => {
  const current = currentArchitectureSnapshot();
  const proposed = proposedArchitectureSnapshot();

  it("classifies additions and endpoint changes without layout noise", () => {
    const diff = diffArchitectures(current, proposed);
    expect(categoryOf(diff, "cache")).toEqual(["added"]);
    expect(categoryOf(diff, "cache->db")).toEqual(["added"]);
    expect(categoryOf(diff, "service->db")).toEqual(["rewired"]);
    expect(diff.records.some((r) => r.category === "removed")).toBe(false);
  });

  it("ignores pure coordinate changes", () => {
    const moved = createGraphSnapshot({
      id: snapshotId("moved"),
      source: current.source,
      entities: current.entities,
      layout: [{ entityId: entityId("client"), x: 999, y: 999 }],
    });
    expect(diffArchitectures(current, moved).records).toEqual([]);
  });

  it("reports a stable-key label change as a rename", () => {
    const before = snapshot("b", [
      { kind: "node", id: entityId("svc"), label: "Orders Service" },
    ]);
    const after = snapshot("a", [
      { kind: "node", id: entityId("svc"), label: "Order Processing" },
    ]);
    const diff = diffArchitectures(before, after);
    expect(diff.records).toHaveLength(1);
    const record = diff.records[0];
    expect(record.category).toBe("renamed");
    if (record.category === "renamed") {
      expect(record.from).toBe("Orders Service");
      expect(record.to).toBe("Order Processing");
    }
  });

  it("reports a group membership change as a move", () => {
    const before = snapshot("b", [
      {
        kind: "node",
        id: entityId("svc"),
        label: "Svc",
        groupId: entityId("g1"),
      },
      {
        kind: "group",
        id: entityId("g1"),
        label: "One",
        memberIds: [entityId("svc")],
      },
      { kind: "group", id: entityId("g2"), label: "Two", memberIds: [] },
    ]);
    const after = snapshot("a", [
      {
        kind: "node",
        id: entityId("svc"),
        label: "Svc",
        groupId: entityId("g2"),
      },
      { kind: "group", id: entityId("g1"), label: "One", memberIds: [] },
      {
        kind: "group",
        id: entityId("g2"),
        label: "Two",
        memberIds: [entityId("svc")],
      },
    ]);
    expect(categoryOf(diffArchitectures(before, after), "svc")).toEqual([
      "moved",
    ]);
  });

  it("reports an attribute change as metadata-changed", () => {
    const before = snapshot("b", [
      {
        kind: "node",
        id: entityId("db"),
        label: "DB",
        attributes: { shape: "cylinder" },
      },
    ]);
    const after = snapshot("a", [
      {
        kind: "node",
        id: entityId("db"),
        label: "DB",
        attributes: { shape: "hexagon" },
      },
    ]);
    const diff = diffArchitectures(before, after);
    const record = diff.records[0];
    expect(record.category).toBe("metadata-changed");
    if (record.category === "metadata-changed") {
      expect(record.changed).toEqual(["shape"]);
    }
  });
});

describe("matchEntities — suggestions and confirmation", () => {
  it("requires confirmation for a re-identified node, then does not degrade to add/remove", () => {
    const before = snapshot("b", [
      { kind: "node", id: entityId("svc"), label: "Orders Service" },
      { kind: "node", id: entityId("db"), label: "Database" },
      {
        kind: "edge",
        id: entityId("svc->db"),
        source: entityId("svc"),
        target: entityId("db"),
      },
    ]);
    const after = snapshot("a", [
      { kind: "node", id: entityId("orders"), label: "Orders Service" },
      { kind: "node", id: entityId("db"), label: "Database" },
      {
        kind: "edge",
        id: entityId("orders->db"),
        source: entityId("orders"),
        target: entityId("db"),
      },
    ]);

    const before_confirm = diffArchitectures(before, after);
    expect(categoryOf(before_confirm, "svc")).toEqual(["removed"]);
    expect(categoryOf(before_confirm, "orders")).toEqual(["added"]);
    const suggestion = before_confirm.suggestions.find(
      (s) => s.base === entityId("svc") && s.target === entityId("orders"),
    );
    expect(suggestion).toBeDefined();
    expect(suggestion?.ambiguous).toBe(false);

    const map = confirmIdentity(
      EMPTY_IDENTITY_MAP,
      entityId("svc"),
      entityId("orders"),
    );
    const after_confirm = diffArchitectures(before, after, map);
    expect(after_confirm.records.some((r) => r.category === "removed")).toBe(
      false,
    );
    expect(after_confirm.records.some((r) => r.category === "added")).toBe(
      false,
    );
    expect(after_confirm.matches.map((m) => m.strategy)).toContain("explicit");
  });

  it("flags an ambiguous match and applies no pairing until resolved", () => {
    const before = snapshot("b", [
      { kind: "node", id: entityId("n1"), label: "Service" },
    ]);
    const after = snapshot("a", [
      { kind: "node", id: entityId("n2"), label: "Service" },
      { kind: "node", id: entityId("n3"), label: "Service" },
    ]);
    const result = matchEntities(before, after);
    expect(result.matches).toEqual([]);
    expect(result.suggestions.every((s) => s.ambiguous)).toBe(true);
    expect(result.unmatchedBase).toContain(entityId("n1"));
  });

  it("never re-offers a rejected pair", () => {
    const before = snapshot("b", [
      { kind: "node", id: entityId("svc"), label: "Orders Service" },
    ]);
    const after = snapshot("a", [
      { kind: "node", id: entityId("orders"), label: "Orders Service" },
    ]);
    const map = rejectIdentity(
      EMPTY_IDENTITY_MAP,
      entityId("svc"),
      entityId("orders"),
    );
    const result = matchEntities(before, after, map);
    expect(result.suggestions).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it("confirms an edge rewire instead of an unrelated add/remove", () => {
    const nodes: GraphEntity[] = [
      { kind: "node", id: entityId("a"), label: "A" },
      { kind: "node", id: entityId("b"), label: "B" },
      { kind: "node", id: entityId("c"), label: "C" },
    ];
    const before = snapshot("b", [
      ...nodes,
      {
        kind: "edge",
        id: entityId("a->b"),
        source: entityId("a"),
        target: entityId("b"),
      },
    ]);
    const after = snapshot("a", [
      ...nodes,
      {
        kind: "edge",
        id: entityId("a->c"),
        source: entityId("a"),
        target: entityId("c"),
      },
    ]);

    const suggestion = matchEntities(before, after).suggestions.find(
      (s) => s.base === entityId("a->b") && s.target === entityId("a->c"),
    );
    expect(suggestion).toBeDefined();

    const map = confirmIdentity(
      EMPTY_IDENTITY_MAP,
      entityId("a->b"),
      entityId("a->c"),
    );
    const diff = diffArchitectures(before, after, map);
    expect(categoryOf(diff, "a->c")).toEqual(["rewired"]);
    expect(diff.records.some((r) => r.category === "removed")).toBe(false);
    expect(diff.records.some((r) => r.category === "added")).toBe(false);
  });
});

describe("views and scenes", () => {
  const current = currentArchitectureSnapshot();
  const proposed = proposedArchitectureSnapshot();
  const diff = diffArchitectures(current, proposed);

  it("builds a side-by-side view listing every entity with correspondences", () => {
    const view = buildSideBySideView(current, proposed, diff);
    expect(view.base).toHaveLength(current.entities.length);
    expect(view.target).toHaveLength(proposed.entities.length);
    const cache = view.target.find((e) => e.entity.id === entityId("cache"));
    expect(cache?.status).toBe("added");
    const rewired = view.target.find(
      (e) => e.entity.id === entityId("service->db"),
    );
    expect(rewired?.status).toBe("rewired");
    expect(rewired?.counterpart).toBe(entityId("service->db"));
    const unchanged = view.target.find(
      (e) => e.entity.id === entityId("client"),
    );
    expect(unchanged?.status).toBe("unchanged");
  });

  it("builds an overlay view keyed by canonical id", () => {
    const overlay = buildOverlayView(current, proposed, diff);
    const cache = overlay.entities.find((e) => e.id === entityId("cache"));
    expect(cache?.status).toBe("added");
    expect(cache?.target?.id).toBe(entityId("cache"));
    const client = overlay.entities.find((e) => e.id === entityId("client"));
    expect(client?.status).toBe("unchanged");
    expect(client?.base?.id).toBe(entityId("client"));
  });

  it("builds a valid overlay snapshot", () => {
    const overlay = buildCompareSnapshot(
      snapshotId("overlay"),
      current,
      proposed,
    );
    expect(validateGraphSnapshot(overlay)).toEqual([]);
    expect(overlay.entities.some((e) => e.id === entityId("cache"))).toBe(true);
  });

  it("converts filtered change records into a story that validates against the overlay", () => {
    const overlay = buildCompareSnapshot(
      snapshotId("overlay"),
      current,
      proposed,
    );
    const story = changesToCompareStory({
      id: storyId("compare"),
      title: "What changed",
      snapshot: overlay,
      records: diff.records,
    });
    expect(story.scenes.map((s) => s.title)).toEqual(["Added", "Rewired"]);
    expect(validateStory(story, overlay)).toEqual([]);
  });

  it("filters change records by category", () => {
    const added = filterChanges(diff.records, ["added"]);
    expect(added.every((r) => r.category === "added")).toBe(true);
    expect(added.length).toBeGreaterThan(0);
  });
});
