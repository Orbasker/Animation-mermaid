import { describe, expect, it } from "vitest";

import { compareSnapshots, comparisonId } from "@/domain/comparison";
import { currentArchitectureSnapshot } from "@/domain/fixtures";
import { snapshotId, validateGraphSnapshot } from "@/domain/graph";
import {
  ACCEPTANCE_FLOWCHART,
  HOSTILE_FLOWCHART,
} from "@/domain/mermaid/fixtures";
import {
  importMermaidFlowchart,
  reconnectedEntityIds,
} from "@/domain/mermaid/import";

const IMPORTED_AT = "2026-08-18T00:00:00.000Z";

function importText(text: string, id = "snap-current") {
  return importMermaidFlowchart({
    text,
    snapshotId: snapshotId(id),
    importedAt: IMPORTED_AT,
  });
}

describe("importMermaidFlowchart acceptance", () => {
  it("reproduces the reference architecture model from its Mermaid source", () => {
    const result = importText(ACCEPTANCE_FLOWCHART);
    expect(result.ok).toBe(true);
    expect(result.snapshot).not.toBeNull();

    const imported = result.snapshot!;
    expect(validateGraphSnapshot(imported)).toEqual([]);

    const reference = currentArchitectureSnapshot();
    const diff = compareSnapshots(comparisonId("c"), reference, imported);
    expect(diff.changes).toEqual([]);
  });

  it("imports all expected nodes, edges, and groups", () => {
    const imported = importText(ACCEPTANCE_FLOWCHART).snapshot!;
    const byKind = (kind: string) =>
      imported.entities.filter((e) => e.kind === kind).map((e) => e.id).sort();
    expect(byKind("node")).toEqual(["api", "client", "db", "service"]);
    expect(byKind("group")).toEqual(["backend"]);
    expect(byKind("edge")).toEqual(["api->service", "client->api", "service->db"]);
  });

  it("preserves the original Mermaid source byte-for-byte", () => {
    const imported = importText(ACCEPTANCE_FLOWCHART).snapshot!;
    expect(imported.source.text).toBe(ACCEPTANCE_FLOWCHART);
    expect(imported.source.importer.importer).toBe("mermaid-flowchart");
    expect(imported.source.importer.importedAt).toBe(IMPORTED_AT);
  });

  it("carries no layout — positioning is a separate pass", () => {
    const imported = importText(ACCEPTANCE_FLOWCHART).snapshot!;
    expect(imported.layout).toBeUndefined();
  });
});

describe("importMermaidFlowchart reimport", () => {
  it("reconnects unchanged entities by semantic key", () => {
    const first = importText(ACCEPTANCE_FLOWCHART).snapshot!;
    const second = importText(ACCEPTANCE_FLOWCHART).snapshot!;
    expect(second.entities.map((e) => e.id)).toEqual(
      first.entities.map((e) => e.id),
    );
  });

  it("keeps ids stable when a label changes, so only that entity differs", () => {
    const original = importText(ACCEPTANCE_FLOWCHART).snapshot!;
    const edited = importText(
      ACCEPTANCE_FLOWCHART.replace("service[Orders Service]", "service[Fulfilment]"),
      "snap-edited",
    ).snapshot!;

    const reconnected = reconnectedEntityIds(original.entities, edited.entities);
    expect(reconnected).toContain("service");
    expect(reconnected).toContain("client");
    expect(reconnected.length).toBe(original.entities.length);

    const diff = compareSnapshots(comparisonId("c"), original, edited);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({ op: "modified", entityId: "service" });
  });
});

describe("importMermaidFlowchart safety and diagnostics", () => {
  const result = importText(HOSTILE_FLOWCHART);
  const codes = result.diagnostics.map((d) => d.code);

  it("still imports the safe parts", () => {
    expect(result.ok).toBe(true);
    const nodeIds = result.snapshot!.entities
      .filter((e) => e.kind === "node")
      .map((e) => e.id);
    expect(nodeIds).toContain("a");
    expect(nodeIds).toContain("b");
  });

  it("sanitizes malicious labels", () => {
    const a = result.snapshot!.entities.find((e) => e.id === "a");
    expect(a).toMatchObject({ kind: "node", label: "Login" });
    expect(JSON.stringify(a)).not.toContain("<script>");
    expect(codes).toContain("label-sanitized");
  });

  it("ignores init directives, click handlers, and styling", () => {
    expect(codes).toContain("directive-ignored");
    expect(codes).toContain("interaction-ignored");
    expect(codes).toContain("styling-ignored");
  });

  it("reports unsupported constructs with source locations", () => {
    const ampersand = result.diagnostics.find((d) => d.code === "unsupported-ampersand");
    expect(ampersand).toBeDefined();
    expect(ampersand!.line).toBeGreaterThan(0);
    expect(ampersand!.snippet).toContain("&");

    const unrecognized = result.diagnostics.find(
      (d) => d.code === "unrecognized-statement",
    );
    expect(unrecognized).toBeDefined();
  });
});
