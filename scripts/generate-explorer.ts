import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  buildStructureDiagram,
  buildStructureExplorerHtml,
  StructureDiagramError,
  type StructureDiagram,
} from "@/preview";

/**
 * Generates a single self-contained HTML structure explorer from one or more Mermaid `.mmd`
 * files. Each file becomes a tab whose subgraphs can be collapsed and expanded.
 *
 * Usage:
 *   pnpm explorer:build [--out <file.html>] [--title <title>] <input.mmd> [more.mmd ...]
 *
 * With no inputs it builds from the samples in `docs/examples/*.mmd`.
 */

const DEFAULT_INPUTS = [
  "docs/examples/catalog-current-mongo.mmd",
  "docs/examples/catalog-new-postgres.mmd",
  "docs/examples/sw-8636-catalog-migration.mmd",
];

function parseArgs(argv: readonly string[]) {
  const inputs: string[] = [];
  let out = "docs/examples/structure-explorer.html";
  let title = "Mermaid structure explorer";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") out = argv[(i += 1)];
    else if (arg === "--title") title = argv[(i += 1)];
    else inputs.push(arg);
  }
  return {
    inputs: inputs.length > 0 ? inputs : DEFAULT_INPUTS,
    out,
    title,
  };
}

function humanName(path: string): string {
  return basename(path).replace(/\.mmd$/i, "");
}

/**
 * Bundles the browser parser entry with esbuild so the exported file can re-parse edited
 * Mermaid in-page through the app's real importer. Uses the esbuild CLI (rather than its JS
 * API) so it works regardless of whether the platform binary's install script ran.
 */
function bundleParser(): string {
  const require = createRequire(import.meta.url);
  const esbuild = require.resolve("esbuild/bin/esbuild");
  const dir = mkdtempSync(join(tmpdir(), "explorer-parser-"));
  const out = join(dir, "parser.js");
  try {
    execFileSync(
      process.execPath,
      [
        esbuild,
        "src/preview/browser-entry.ts",
        "--bundle",
        "--format=iife",
        "--platform=browser",
        "--target=es2018",
        "--minify",
        "--tsconfig=tsconfig.json",
        `--outfile=${out}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  const { inputs, out, title } = parseArgs(process.argv.slice(2));

  const diagrams: StructureDiagram[] = [];
  for (const input of inputs) {
    const source = readFileSync(resolve(input), "utf8");
    try {
      diagrams.push(
        buildStructureDiagram({
          id: humanName(input),
          name: humanName(input),
          source,
        }),
      );
    } catch (error) {
      if (error instanceof StructureDiagramError) {
        console.error(`Skipping ${input}: ${error.reason}`);
        continue;
      }
      throw error;
    }
  }

  if (diagrams.length === 0) {
    console.error("No diagrams could be built from the given inputs.");
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const elkSource = readFileSync(
    require.resolve("elkjs/lib/elk.bundled.js"),
    "utf8",
  );

  const parserSource = bundleParser();

  const html = buildStructureExplorerHtml({
    diagrams,
    elkSource,
    parserSource,
    title,
  });
  writeFileSync(resolve(out), html, "utf8");

  const kb = Math.round((Buffer.byteLength(html) / 1024) * 10) / 10;
  console.log(
    `Wrote ${out} (${kb} KB) with ${diagrams.length} diagram(s): ${diagrams
      .map((d) => d.name)
      .join(", ")}`,
  );
}

main();
