import { describe, expect, it } from "vitest";

import {
  buildStructureExplorerHtml,
  escapeHtml,
  serializeDiagrams,
} from "@/preview/build-explorer";
import { buildStructureDiagram } from "@/preview/structure-model";

const ELK_STUB = "/* elk bundle */ window.ELK = function () {};";

function sampleDiagram(name = "Sample") {
  return buildStructureDiagram({
    id: name.toLowerCase(),
    name,
    source: `flowchart TD\n  subgraph g[Group]\n    a[Alpha]\n  end\n  a --> b[Beta]`,
  });
}

describe("serializeDiagrams", () => {
  it("escapes < so a label cannot terminate the script element", () => {
    const serialized = serializeDiagrams([
      {
        id: "x",
        name: "</script><b>",
        direction: "TD",
        nodes: [],
        groups: [],
        edges: [],
        warnings: [],
        source: "flowchart TD",
      },
    ]);
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c");
  });
});

describe("buildStructureExplorerHtml", () => {
  it("produces a self-contained document with no external references", () => {
    const html = buildStructureExplorerHtml({
      diagrams: [sampleDiagram()],
      elkSource: ELK_STUB,
    });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(ELK_STUB);
    expect(html).toContain("window.__EXPLORER__");
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
  });

  it("omits the editor and parser when no parserSource is given", () => {
    const html = buildStructureExplorerHtml({
      diagrams: [sampleDiagram()],
      elkSource: ELK_STUB,
    });
    expect(html).not.toContain('id="edit"');
  });

  it("inlines the parser bundle and editor when parserSource is given", () => {
    const parser = "/* parser */ window.__STRUCTURE__ = {};";
    const html = buildStructureExplorerHtml({
      diagrams: [sampleDiagram()],
      elkSource: ELK_STUB,
      parserSource: parser,
    });
    expect(html).toContain(parser);
    expect(html).toContain('id="edit"');
    expect(html).toContain('id="editor-text"');
    expect(html).not.toMatch(/(src|href)\s*=\s*["']https?:/i);
  });

  it("embeds every diagram model and title", () => {
    const html = buildStructureExplorerHtml({
      diagrams: [sampleDiagram("First"), sampleDiagram("Second")],
      title: "My explorer",
      elkSource: ELK_STUB,
    });

    expect(html).toContain("<title>My explorer</title>");
    expect(html).toContain('"First"');
    expect(html).toContain('"Second"');
  });

  it("escapes a hostile title", () => {
    const html = buildStructureExplorerHtml({
      diagrams: [sampleDiagram()],
      title: '<img src=x onerror="alert(1)">',
      elkSource: ELK_STUB,
    });
    expect(html).toContain("&lt;img");
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
  });
});

describe("escapeHtml", () => {
  it("escapes the five markup-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
