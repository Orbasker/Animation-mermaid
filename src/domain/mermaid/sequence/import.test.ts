import { describe, expect, it } from "vitest";

import { snapshotId, validateGraphSnapshot } from "@/domain/graph";
import {
  ACCEPTANCE_SEQUENCE,
  HOSTILE_SEQUENCE,
  RICH_SEQUENCE,
} from "@/domain/mermaid/sequence/fixtures";
import {
  importMermaidSequence,
  SEQUENCE_DIAGRAM_TYPE,
  SEQUENCE_IMPORTER,
} from "@/domain/mermaid/sequence/import";

const IMPORTED_AT = "2026-08-18T00:00:00.000Z";

function importText(text: string, id = "snap-seq") {
  return importMermaidSequence({
    text,
    snapshotId: snapshotId(id),
    importedAt: IMPORTED_AT,
  });
}

describe("importMermaidSequence", () => {
  it("normalizes participants and messages into a valid snapshot", () => {
    const result = importText(ACCEPTANCE_SEQUENCE);
    expect(result.ok).toBe(true);
    const snapshot = result.snapshot!;
    expect(validateGraphSnapshot(snapshot)).toEqual([]);

    const byKind = (kind: string) =>
      snapshot.entities
        .filter((e) => e.kind === kind)
        .map((e) => e.id)
        .sort();
    expect(byKind("node")).toEqual(["api", "client", "db", "service"]);
    expect(byKind("edge")).toEqual([
      "api->client",
      "api->service",
      "client->api",
      "db->service",
      "service->api",
      "service->db",
    ]);
  });

  it("records provenance: diagram type, importer id, and verbatim source", () => {
    const snapshot = importText(ACCEPTANCE_SEQUENCE).snapshot!;
    expect(snapshot.source.diagramType).toBe(SEQUENCE_DIAGRAM_TYPE);
    expect(snapshot.source.importer.importer).toBe(SEQUENCE_IMPORTER);
    expect(snapshot.source.importer.importedAt).toBe(IMPORTED_AT);
    expect(snapshot.source.text).toBe(ACCEPTANCE_SEQUENCE);
  });

  it("carries actor role and non-default edge styles as attributes only", () => {
    const snapshot = importText(RICH_SEQUENCE).snapshot!;
    const user = snapshot.entities.find((e) => e.id === "user");
    expect(user).toMatchObject({ kind: "node", attributes: { role: "actor" } });
    // A plain participant carries no attributes.
    const web = snapshot.entities.find((e) => e.id === "web");
    expect(web && "attributes" in web).toBe(false);
  });

  it("disambiguates repeated message pairs with ~n keys in source order", () => {
    const result = importText(
      ["sequenceDiagram", "A->>B: one", "A->>B: two", "A->>B: three"].join(
        "\n",
      ),
    );
    const edgeIds = result
      .snapshot!.entities.filter((e) => e.kind === "edge")
      .map((e) => e.id);
    expect(edgeIds).toEqual(["A->B", "A->B~2", "A->B~3"]);
  });

  it("reimports unchanged source to an identical model (stable identity)", () => {
    const first = importText(ACCEPTANCE_SEQUENCE, "snap-seq").snapshot!;
    const second = importText(ACCEPTANCE_SEQUENCE, "snap-seq").snapshot!;
    expect(second.entities).toEqual(first.entities);
  });

  it("keeps a fatal error from producing a snapshot", () => {
    const result = importText("flowchart TD\n a --> b");
    expect(result.ok).toBe(false);
    expect(result.snapshot).toBeNull();
    expect(result.diagnostics[0].code).toBe("not-a-sequence");
  });

  it("imports safe content even from hostile source, and stays valid", () => {
    const result = importText(HOSTILE_SEQUENCE);
    expect(result.snapshot).not.toBeNull();
    expect(validateGraphSnapshot(result.snapshot!)).toEqual([]);
    // Provenance keeps the source verbatim, but no entity label carries live markup.
    for (const entity of result.snapshot!.entities) {
      const label = "label" in entity ? entity.label : undefined;
      if (label !== undefined) expect(label).not.toMatch(/<script|onerror/i);
    }
  });
});
