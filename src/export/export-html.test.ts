import { createHash } from "node:crypto";

import { describe, expect, it, beforeEach } from "vitest";

import { createProjectDocument, projectId } from "@/domain/project-document";
import { createGraphSnapshot, entityId, snapshotId } from "@/domain/graph";
import { createStory, sceneId, storyId } from "@/domain/story";
import type { ProjectDocument } from "@/domain/project-document";
import { buildExportPayload } from "@/export/export-payload";
import {
  buildExportHtml,
  escapeHtml,
  EXPORT_CONTENT_SECURITY_POLICY,
  PLAYER_SCRIPT_CSP_HASH,
  PLAYER_STYLE_CSP_HASH,
  serializeEmbeddedPayload,
} from "@/export/export-html";
import {
  PLAYER_APP_SOURCE,
  PLAYER_SCRIPT_SOURCE,
  PLAYER_STYLES,
  RENDER_FUNCTION_SOURCE,
} from "@/export/player-runtime";

function sha256(source: string): string {
  return `sha256-${createHash("sha256").update(source, "utf8").digest("base64")}`;
}

const HOSTILE_LABEL = "<script>window.__xss=1</script>Login";
const HOSTILE_ANNOTATION = '</script><img src=x onerror="window.__xss=1">';
const HOSTILE_TITLE = 'Break "out" of <the> attribute';

function hostileProject(): ProjectDocument {
  const snapshot = createGraphSnapshot({
    id: snapshotId("snap-hostile"),
    source: {
      diagramType: "flowchart",
      text: "flowchart TD",
      importer: {
        importer: "mermaid-flowchart",
        importerVersion: "0.1.0",
        importedAt: "2026-08-18T00:00:00.000Z",
      },
    },
    entities: [
      { kind: "node", id: entityId("a"), label: HOSTILE_LABEL },
      { kind: "node", id: entityId("b"), label: "Home" },
      {
        kind: "edge",
        id: entityId("a->b"),
        source: entityId("a"),
        target: entityId("b"),
      },
    ],
    layout: [
      { entityId: entityId("a"), x: 0, y: 0 },
      { entityId: entityId("b"), x: 0, y: 120 },
    ],
  });

  return createProjectDocument({
    id: projectId("proj-hostile"),
    name: HOSTILE_TITLE,
    snapshots: [snapshot],
    stories: [
      createStory({
        id: storyId("story-hostile"),
        title: HOSTILE_TITLE,
        snapshotId: snapshot.id,
        scenes: [
          {
            id: sceneId("scene-1"),
            title: HOSTILE_TITLE,
            durationMs: 1000,
            actions: [
              { type: "reveal", target: entityId("a") },
              { type: "reveal", target: entityId("b") },
              { type: "reveal", target: entityId("a->b") },
              {
                type: "annotate",
                target: entityId("a"),
                text: HOSTILE_ANNOTATION,
              },
            ],
          },
        ],
      }),
    ],
  });
}

describe("escapeHtml", () => {
  it("neutralizes tag and attribute delimiters", () => {
    expect(escapeHtml('<a href="x">&\'')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});

describe("serializeEmbeddedPayload", () => {
  it("escapes '<' so a label cannot terminate the script element", () => {
    const payload = buildExportPayload(
      hostileProject(),
      storyId("story-hostile"),
    );
    const embedded = serializeEmbeddedPayload(payload);
    expect(embedded).not.toContain("</script>");
    expect(embedded).not.toContain("<script>");
    expect(embedded).toContain("\\u003cscript>");
    // The escaped payload is still valid JSON that restores the original text.
    const restored = JSON.parse(embedded) as typeof payload;
    expect(restored.snapshot.entities[0]).toMatchObject({
      label: HOSTILE_LABEL,
    });
  });
});

describe("buildExportHtml", () => {
  it("is a self-contained document with no external references", () => {
    const html = buildExportHtml(
      buildExportPayload(hostileProject(), storyId("story-hostile")),
    );

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    expect(html).not.toContain("url(http");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="http');
    expect(html).not.toContain("<iframe");
    // Styles and runtime are inlined.
    expect(html).toContain(PLAYER_STYLES);
    expect(html).toContain(RENDER_FUNCTION_SOURCE);
    expect(html).toContain(PLAYER_APP_SOURCE);
  });

  it("keeps hostile labels and links out of executable markup", () => {
    const html = buildExportHtml(
      buildExportPayload(hostileProject(), storyId("story-hostile")),
    );

    // The only script elements are the JSON data block and the runtime — the hostile
    // `<script>`/`</script>` in the label produces no extra script boundary.
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).not.toContain("<script>window.__xss=1");
    expect(html).not.toContain('onerror="window.__xss=1"');
    // The label survives as escaped, inert text in the no-JS fallback.
    expect(html).toContain("&lt;script&gt;window.__xss=1&lt;/script&gt;Login");
  });

  it("carries a no-JS static fallback and the reduced-motion contract", () => {
    const html = buildExportHtml(
      buildExportPayload(hostileProject(), storyId("story-hostile")),
    );

    expect(html).toContain("<noscript>");
    expect(html).toContain('class="staticFallback"');
    expect(html).toContain("prefers-reduced-motion: reduce");
    expect(html).toContain(escapeHtml(HOSTILE_TITLE));
  });

  it("escapes the document title", () => {
    const html = buildExportHtml(
      buildExportPayload(hostileProject(), storyId("story-hostile")),
    );
    expect(html).toContain(
      `<title>${escapeHtml(`${HOSTILE_TITLE} — ${HOSTILE_TITLE}`)}</title>`,
    );
    expect(html).not.toContain('<title>Break "out"');
  });
});

describe("export content security policy", () => {
  it("advertises hashes that match the exact embedded script and style", () => {
    // If the runtime or styles change, regenerate the constants in export-html.ts.
    expect(PLAYER_SCRIPT_CSP_HASH).toBe(sha256(PLAYER_SCRIPT_SOURCE));
    expect(PLAYER_STYLE_CSP_HASH).toBe(sha256(PLAYER_STYLES));
  });

  it("locks the document to the hashed assets and denies everything else", () => {
    expect(EXPORT_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(EXPORT_CONTENT_SECURITY_POLICY).toContain(
      `script-src '${PLAYER_SCRIPT_CSP_HASH}'`,
    );
    expect(EXPORT_CONTENT_SECURITY_POLICY).toContain(
      `style-src '${PLAYER_STYLE_CSP_HASH}'`,
    );
    expect(EXPORT_CONTENT_SECURITY_POLICY).not.toContain("'unsafe-inline'");
  });

  it("carries the policy in the exported document's meta tag", () => {
    const html = buildExportHtml(
      buildExportPayload(hostileProject(), storyId("story-hostile")),
    );

    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CONTENT_SECURITY_POLICY}" />`,
    );
  });
});

describe("player boot in a DOM", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (globalThis as Record<string, unknown>).__xss;
    if (typeof globalThis.requestAnimationFrame !== "function") {
      (globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
      (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
    }
  });

  it("renders hostile content as inert text and executes no injected script", () => {
    const payload = buildExportPayload(
      hostileProject(),
      storyId("story-hostile"),
    );

    const app = document.createElement("main");
    app.id = "app";
    const data = document.createElement("script");
    data.type = "application/json";
    data.id = "story-data";
    data.textContent = JSON.stringify(payload);
    document.body.appendChild(app);
    document.body.appendChild(data);

    // Execute the exact runtime the export ships.
    new Function(`${RENDER_FUNCTION_SOURCE}\n${PLAYER_APP_SOURCE}`)();

    // No script or image element smuggled in through a label/annotation.
    expect(app.querySelectorAll("script, img, iframe")).toHaveLength(0);
    expect((globalThis as Record<string, unknown>).__xss).toBeUndefined();

    // The label is present as text, exactly as authored.
    const labels = [...app.querySelectorAll(".nodeLabel")].map(
      (node) => node.textContent,
    );
    expect(labels).toContain(HOSTILE_LABEL);

    // Controls and outline were built.
    expect(app.querySelector(".playButton")).not.toBeNull();
    expect(app.querySelectorAll(".outlineItem")).toHaveLength(1);
  });
});
