import { describe, expect, it } from "vitest";

import { snapshotId, validateGraphSnapshot } from "@/domain/graph";
import { compareSnapshots, comparisonId } from "@/domain/comparison";
import { importGraphvizDot } from "@/domain/graphviz/import";
import {
  ACCEPTANCE_DOT,
  HOSTILE_DOT,
  RICH_DOT,
} from "@/domain/graphviz/fixtures";

const IMPORTED_AT = "2026-08-24T00:00:00.000Z";

function importText(text: string, id = "snap-dot") {
  return importGraphvizDot({
    text,
    snapshotId: snapshotId(id),
    importedAt: IMPORTED_AT,
  });
}

describe("importGraphvizDot acceptance", () => {
  const result = importText(ACCEPTANCE_DOT);

  it("imports a fully valid normalized snapshot", () => {
    expect(result.ok).toBe(true);
    expect(result.snapshot).not.toBeNull();
    expect(validateGraphSnapshot(result.snapshot!)).toEqual([]);
    expect(result.direction).toBe("TB");
  });

  it("imports the expected nodes, groups, and edges", () => {
    const imported = result.snapshot!;
    const byKind = (kind: string) =>
      imported.entities
        .filter((e) => e.kind === kind)
        .map((e) => e.id)
        .sort();
    expect(byKind("node")).toEqual(["api", "client", "db", "service"]);
    expect(byKind("group")).toEqual(["cluster_backend"]);
    expect(byKind("edge")).toEqual([
      "api->service",
      "client->api",
      "service->db",
    ]);
  });

  it("maps `cluster_*` to a nested container with its members", () => {
    const imported = result.snapshot!;
    const group = imported.entities.find((e) => e.id === "cluster_backend");
    expect(group).toMatchObject({
      kind: "group",
      label: "Backend",
      memberIds: ["api", "service"],
    });
    const api = imported.entities.find((e) => e.id === "api");
    expect(api).toMatchObject({
      groupId: "cluster_backend",
      label: "API Gateway",
    });
  });

  it("carries node shapes as renderer-neutral attributes", () => {
    const db = result.snapshot!.entities.find((e) => e.id === "db");
    expect(db).toMatchObject({
      label: "Database",
      attributes: { shape: "cylinder" },
    });
  });

  it("preserves the original DOT source and provenance", () => {
    const imported = result.snapshot!;
    expect(imported.source.text).toBe(ACCEPTANCE_DOT);
    expect(imported.source.diagramType).toBe("graphviz");
    expect(imported.source.importer.importer).toBe("graphviz-dot");
    expect(imported.source.importer.importedAt).toBe(IMPORTED_AT);
  });

  it("carries no layout — positioning is a separate pass", () => {
    expect(result.snapshot!.layout).toBeUndefined();
  });
});

describe("importGraphvizDot reimport", () => {
  it("reconnects unchanged entities by semantic key", () => {
    const first = importText(ACCEPTANCE_DOT).snapshot!;
    const second = importText(ACCEPTANCE_DOT).snapshot!;
    expect(second.entities.map((e) => e.id)).toEqual(
      first.entities.map((e) => e.id),
    );
  });

  it("keeps ids stable when a label changes, so only that entity differs", () => {
    const original = importText(ACCEPTANCE_DOT).snapshot!;
    const edited = importText(
      ACCEPTANCE_DOT.replace("Orders Service", "Fulfilment"),
      "snap-edited",
    ).snapshot!;

    const diff = compareSnapshots(comparisonId("c"), original, edited);
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({
      op: "modified",
      entityId: "service",
    });
  });
});

describe("importGraphvizDot nested clusters (RICH)", () => {
  const imported = importText(RICH_DOT).snapshot!;

  it("nests clusters and preserves drill-down membership", () => {
    expect(validateGraphSnapshot(imported)).toEqual([]);
    const app = imported.entities.find((e) => e.id === "cluster_app");
    const core = imported.entities.find((e) => e.id === "cluster_core");
    expect(app).toMatchObject({
      label: "Application",
      memberIds: ["ui", "cluster_core"],
    });
    expect(core).toMatchObject({
      label: "Core",
      memberIds: ["decide", "work"],
    });
    expect(imported.entities.find((e) => e.id === "decide")).toMatchObject({
      groupId: "cluster_core",
      attributes: { shape: "diamond" },
    });
  });

  it("carries edge labels and dashed/bold styling, and reads rankdir", () => {
    expect(importText(RICH_DOT).direction).toBe("LR");
    const edge = (id: string) => imported.entities.find((e) => e.id === id);
    expect(edge("ui->decide")).toMatchObject({ label: "submit" });
    expect(edge("decide->done")).toMatchObject({
      label: "no",
      attributes: { line: "dotted" },
    });
    expect(edge("work->done")).toMatchObject({ attributes: { line: "thick" } });
  });
});

describe("importGraphvizDot safety and diagnostics (HOSTILE)", () => {
  const result = importText(HOSTILE_DOT);
  const codes = result.diagnostics.map((d) => d.code);

  it("still imports the safe parts", () => {
    expect(result.ok).toBe(true);
    const nodeIds = result
      .snapshot!.entities.filter((e) => e.kind === "node")
      .map((e) => e.id);
    expect(nodeIds).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("sanitizes malicious labels", () => {
    const a = result.snapshot!.entities.find((e) => e.id === "a");
    expect(a).toMatchObject({ label: "Login" });
    expect(JSON.stringify(a)).not.toContain("<script>");
    expect(codes).toContain("label-sanitized");
  });

  it("reports default attributes, ports, and subgraph endpoints", () => {
    expect(codes).toContain("default-attributes-ignored");
    expect(codes).toContain("port-ignored");
    expect(codes).toContain("unsupported-endpoint");
  });

  it("anchors every diagnostic to a source line", () => {
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.line).toBeGreaterThan(0);
    }
  });
});
