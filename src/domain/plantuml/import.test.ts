import { describe, expect, it } from "vitest";

import { snapshotId, validateGraphSnapshot } from "@/domain/graph";
import {
  importPlantuml,
  PLANTUML_DIAGRAM_TYPE,
  PLANTUML_IMPORTER,
} from "@/domain/plantuml/import";
import {
  ACCEPTANCE_PLANTUML,
  HOSTILE_PLANTUML,
  RICH_PLANTUML,
} from "@/domain/plantuml/fixtures";

const IMPORTED_AT = "2026-08-24T00:00:00.000Z";

function importText(text: string, id = "snap-uml") {
  return importPlantuml({
    text,
    snapshotId: snapshotId(id),
    importedAt: IMPORTED_AT,
  });
}

const idsOfKind = (
  snapshot: NonNullable<ReturnType<typeof importText>["snapshot"]>,
  kind: string,
) =>
  snapshot.entities
    .filter((e) => e.kind === kind)
    .map((e) => e.id)
    .sort();

describe("importPlantuml", () => {
  it("normalizes elements, relations, and nested containers into a valid snapshot", () => {
    const result = importText(ACCEPTANCE_PLANTUML);
    expect(result.ok).toBe(true);
    const snapshot = result.snapshot!;
    expect(validateGraphSnapshot(snapshot)).toEqual([]);

    expect(idsOfKind(snapshot, "node")).toEqual([
      "api",
      "browser",
      "cdn",
      "db",
      "orders",
    ]);
    expect(idsOfKind(snapshot, "group")).toEqual(["app", "web"]);
    expect(idsOfKind(snapshot, "edge")).toEqual([
      "api->orders",
      "browser->api",
      "browser->cdn",
      "orders->db",
    ]);
  });

  it("maps packages to nested containers with their members", () => {
    const snapshot = importText(ACCEPTANCE_PLANTUML).snapshot!;
    const web = snapshot.entities.find((e) => e.id === "web");
    expect(web).toMatchObject({
      kind: "group",
      label: "Web Tier",
      memberIds: ["browser", "cdn"],
    });
    // A node inside a package carries a back-reference to it.
    const browser = snapshot.entities.find((e) => e.id === "browser");
    expect(browser).toMatchObject({ kind: "node", groupId: "web" });
  });

  it("carries the declaring keyword and edge labels through", () => {
    const snapshot = importText(ACCEPTANCE_PLANTUML).snapshot!;
    const api = snapshot.entities.find((e) => e.id === "api");
    expect(api).toMatchObject({
      kind: "node",
      label: "API Gateway",
      attributes: { type: "component" },
    });
    const edge = snapshot.entities.find((e) => e.id === "browser->cdn");
    expect(edge).toMatchObject({ kind: "edge", label: "loads" });
  });

  it("records provenance: diagram type, importer id, and verbatim source", () => {
    const snapshot = importText(ACCEPTANCE_PLANTUML).snapshot!;
    expect(snapshot.source.diagramType).toBe(PLANTUML_DIAGRAM_TYPE);
    expect(snapshot.source.importer.importer).toBe(PLANTUML_IMPORTER);
    expect(snapshot.source.importer.importedAt).toBe(IMPORTED_AT);
    expect(snapshot.source.text).toBe(ACCEPTANCE_PLANTUML);
  });

  it("classifies every relation kind and skips class-body members", () => {
    const result = importText(RICH_PLANTUML);
    expect(result.ok).toBe(true);
    const snapshot = result.snapshot!;
    expect(validateGraphSnapshot(snapshot)).toEqual([]);

    // Members inside a class body never become nodes.
    expect(idsOfKind(snapshot, "node")).toEqual([
      "Canvas",
      "Circle",
      "Shape",
      "Square",
    ]);

    const relationOf = (id: string) => {
      const edge = snapshot.entities.find((e) => e.id === id);
      return edge && "attributes" in edge
        ? edge.attributes?.relation
        : undefined;
    };
    expect(relationOf("Shape->Circle")).toBe("extension");
    expect(relationOf("Canvas->Shape")).toBe("composition");
    expect(relationOf("Canvas->Circle")).toBe("aggregation");
    // A dashed dependency is disambiguated from the composition of the same pair.
    const dep = snapshot.entities.find((e) => e.id === "Canvas->Shape~2");
    expect(dep).toMatchObject({
      kind: "edge",
      label: "draws",
      attributes: { line: "dashed", relation: "dependency" },
    });
  });

  it("nests namespaces and assigns members to the innermost container", () => {
    const snapshot = importText(RICH_PLANTUML).snapshot!;
    const domain = snapshot.entities.find((e) => e.id === "domain");
    expect(domain).toMatchObject({
      kind: "group",
      memberIds: ["Shape", "Circle", "Square"],
    });
    const shape = snapshot.entities.find((e) => e.id === "Shape");
    expect(shape).toMatchObject({ kind: "node", groupId: "domain" });
  });

  it("reimports unchanged source to an identical model (stable identity)", () => {
    const first = importText(ACCEPTANCE_PLANTUML, "snap-uml").snapshot!;
    const second = importText(ACCEPTANCE_PLANTUML, "snap-uml").snapshot!;
    expect(second.entities).toEqual(first.entities);
  });

  it("keeps a fatal error (missing @startuml) from producing a snapshot", () => {
    const result = importText("flowchart TD\n a --> b");
    expect(result.ok).toBe(false);
    expect(result.snapshot).toBeNull();
    expect(result.diagnostics[0].code).toBe("not-plantuml");
  });

  it("imports safe content even from hostile source, and stays valid", () => {
    const result = importText(HOSTILE_PLANTUML);
    expect(result.snapshot).not.toBeNull();
    expect(validateGraphSnapshot(result.snapshot!)).toEqual([]);

    // The preprocessor include is refused and reported.
    expect(
      result.diagnostics.some((d) => d.code === "preprocessor-ignored"),
    ).toBe(true);

    // Safe elements and the relation still import.
    expect(idsOfKind(result.snapshot!, "node")).toEqual(["home", "login"]);
    // No entity label carries live markup, though provenance keeps the source verbatim.
    for (const entity of result.snapshot!.entities) {
      const label = "label" in entity ? entity.label : undefined;
      if (label !== undefined) expect(label).not.toMatch(/<script|onerror/i);
    }
  });
});
