#!/usr/bin/env node

// Emit a CycloneDX 1.5 SBOM for the production dependency closure.
//
// By default it shells out to `pnpm list --prod --json --depth Infinity`, which
// resolves the same closure the production build ships. Pass `--stdin` to read a
// prerecorded `pnpm list` payload instead — used by the test to assert the
// mapping without a live install.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const readPnpmList = () => {
  if (process.argv.includes("--stdin")) {
    return readFileSync(0, "utf8");
  }
  return execFileSync(
    "pnpm",
    ["list", "--prod", "--json", "--depth", "Infinity"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
};

const encodePurl = (name, version) => {
  // Scoped names keep their leading "@" but the "/" is encoded per the purl spec.
  const encodedName = name
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `pkg:npm/${encodedName}@${version}`;
};

/**
 * @param {Record<string, { version?: string; dependencies?: object; optionalDependencies?: object }>} deps
 * @param {Map<string, { name: string; version: string }>} into
 */
const collect = (deps, into) => {
  if (!deps) return;
  for (const [name, node] of Object.entries(deps)) {
    const version = node?.version;
    // Workspace links and unresolved entries have no concrete version to pin.
    if (typeof version !== "string" || version.length === 0) continue;
    const key = `${name}@${version}`;
    if (!into.has(key)) {
      into.set(key, { name, version });
    }
    collect(node.dependencies, into);
    collect(node.optionalDependencies, into);
  }
};

const importers = JSON.parse(readPnpmList());
const rootImporter = Array.isArray(importers) ? importers[0] : importers;

const components = new Map();
for (const importer of Array.isArray(importers) ? importers : [importers]) {
  collect(importer.dependencies, components);
  collect(importer.optionalDependencies, components);
}

const componentList = [...components.values()];
componentList.sort((a, b) => {
  const left = `${a.name}@${a.version}`;
  const right = `${b.name}@${b.version}`;
  return left.localeCompare(right);
});

// No timestamp or random serial number: a byte-identical dependency closure
// produces a byte-identical SBOM, so the artifact diffs cleanly across builds.
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: rootImporter?.name ?? "animation-mermaid",
      version: rootImporter?.version ?? "0.0.0",
    },
  },
  components: componentList.map((entry) => ({
    type: "library",
    name: entry.name,
    version: entry.version,
    purl: encodePurl(entry.name, entry.version),
  })),
};

process.stdout.write(`${JSON.stringify(sbom, null, 2)}\n`);
