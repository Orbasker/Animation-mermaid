import { describe, expect, it } from "vitest";

import { entityId, snapshotId } from "@/domain/graph";
import { IMPORTER_CAPABILITIES } from "@/domain/import/capabilities";
import {
  detectImporter,
  importDiagram,
  importerByDiagramType,
  listImporterCapabilities,
} from "@/domain/import/registry";
import { ACCEPTANCE_DOT } from "@/domain/graphviz/fixtures";
import { ACCEPTANCE_FLOWCHART } from "@/domain/mermaid/fixtures";
import { ACCEPTANCE_SEQUENCE } from "@/domain/mermaid/sequence/fixtures";
import { createStory, sceneId, storyId } from "@/domain/story";
import { renderStoryAt } from "@/domain/story-engine";

const IMPORTED_AT = "2026-08-18T00:00:00.000Z";

describe("importer registry", () => {
  it("detects each grammar from its header", () => {
    expect(detectImporter(ACCEPTANCE_FLOWCHART)?.capabilities.importer).toBe(
      "mermaid-flowchart",
    );
    expect(detectImporter(ACCEPTANCE_SEQUENCE)?.capabilities.importer).toBe(
      "mermaid-sequence",
    );
    expect(detectImporter(ACCEPTANCE_DOT)?.capabilities.importer).toBe(
      "graphviz-dot",
    );
    expect(detectImporter("erDiagram\n A ||--o{ B : has")).toBeNull();
  });

  it("routes DOT `graph { … }` to graphviz but Mermaid `graph LR` to the flowchart importer", () => {
    expect(detectImporter("graph G { a -- b }")?.capabilities.importer).toBe(
      "graphviz-dot",
    );
    expect(detectImporter("graph LR\n a --> b")?.capabilities.importer).toBe(
      "mermaid-flowchart",
    );
  });

  it("dispatches an import through the matching importer", () => {
    const flow = importDiagram({
      text: ACCEPTANCE_FLOWCHART,
      snapshotId: snapshotId("f"),
      importedAt: IMPORTED_AT,
    });
    expect(flow.snapshot?.source.diagramType).toBe("flowchart");

    const seq = importDiagram({
      text: ACCEPTANCE_SEQUENCE,
      snapshotId: snapshotId("s"),
      importedAt: IMPORTED_AT,
    });
    expect(seq.snapshot?.source.diagramType).toBe("sequenceDiagram");

    const dot = importDiagram({
      text: ACCEPTANCE_DOT,
      snapshotId: snapshotId("d"),
      importedAt: IMPORTED_AT,
    });
    expect(dot.snapshot?.source.diagramType).toBe("graphviz");
  });

  it("never corrupts on unrecognized source: no snapshot, error diagnostic, no importer", () => {
    const result = importDiagram({
      text: "classDiagram\n class Foo",
      snapshotId: snapshotId("x"),
      importedAt: IMPORTED_AT,
    });
    expect(result.ok).toBe(false);
    expect(result.snapshot).toBeNull();
    expect(result.capabilities).toBeNull();
    expect(result.diagnostics[0].code).toBe("unrecognized-diagram");
  });

  it("reports capabilities for every importer for the UI", () => {
    const ids = listImporterCapabilities().map((c) => c.importer);
    expect(ids).toContain("mermaid-flowchart");
    expect(ids).toContain("mermaid-sequence");
    expect(ids).toContain("graphviz-dot");
    // The elk-free capability list stays in sync with the runtime registry.
    expect(IMPORTER_CAPABILITIES.map((c) => c.importer)).toEqual(ids);
    for (const capability of IMPORTER_CAPABILITIES) {
      expect(capability.features.length).toBeGreaterThan(0);
      expect(capability.summary.length).toBeGreaterThan(0);
    }
  });

  it("looks importers up by the diagram type they write", () => {
    expect(
      importerByDiagramType("sequenceDiagram")?.capabilities.importer,
    ).toBe("mermaid-sequence");
    expect(importerByDiagramType("flowchart")?.capabilities.importer).toBe(
      "mermaid-flowchart",
    );
    expect(importerByDiagramType("nope")).toBeNull();
  });

  it("feeds a sequence snapshot through the unchanged story engine", () => {
    const snapshot = importDiagram({
      text: ACCEPTANCE_SEQUENCE,
      snapshotId: snapshotId("snap-seq"),
      importedAt: IMPORTED_AT,
    }).snapshot!;

    const story = createStory({
      id: storyId("story-seq"),
      title: "Order flow",
      snapshotId: snapshot.id,
      scenes: [
        {
          id: sceneId("scene-1"),
          title: "Client places an order",
          durationMs: 1000,
          actions: [
            { type: "reveal", target: entityId("client") },
            { type: "reveal", target: entityId("api") },
            { type: "reveal", target: entityId("client->api") },
          ],
        },
      ],
    });

    const state = renderStoryAt({ snapshot, story, timestampMs: 1000 });
    const client = state.entities.find((e) => e.id === "client");
    expect(client?.visible).toBe(true);
    expect(client?.opacity).toBe(1);
  });
});
