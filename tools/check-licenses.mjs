#!/usr/bin/env node
// Fails the build when a dependency ships under a strong- or network-copyleft
// license that is incompatible with distributing this app. Implemented as a
// denylist so a new permissive/weak-copyleft license never trips the gate; only
// the explicitly forbidden families do.
//
// SPDX expressions are resolved: an "OR" passes when any alternative is allowed,
// an "AND" passes only when every part is allowed. "Unknown" is reported as a
// warning (unlabeled first-party and transitive packages) but does not fail.

import { execFileSync } from "node:child_process";

const DENY_PATTERNS = [
  /^AGPL-/i,
  /^GPL-\d/i, // GPL-2.0-only, GPL-3.0-or-later, ... (LGPL is matched separately and allowed)
  /^SSPL-/i,
  /^BUSL-/i,
  /(^|\b)Commons-Clause(\b|$)/i,
];

const isDeniedLeaf = (license) => {
  const token = license.trim().replace(/^\(+|\)+$/g, "");
  if (/^LGPL-/i.test(token)) return false;
  return DENY_PATTERNS.some((pattern) => pattern.test(token));
};

// A license expression is allowed when its boolean structure resolves to true,
// treating each leaf as "allowed unless denied". SPDX operators are uppercase
// and whitespace-delimited (`MIT OR Apache-2.0`), which keeps them distinct
// from the lowercase "or" inside ids like `GPL-3.0-or-later`.
const isExpressionAllowed = (expression) => {
  const normalized = expression.replace(/[()]/g, " ").trim();
  if (/\sOR\s/.test(normalized)) {
    return normalized.split(/\sOR\s/).some((part) => isExpressionAllowed(part));
  }
  if (/\sAND\s/.test(normalized)) {
    return normalized
      .split(/\sAND\s/)
      .every((part) => isExpressionAllowed(part));
  }
  return !isDeniedLeaf(normalized);
};

const raw = execFileSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

/** @type {Record<string, Array<{ name: string; versions?: string[] }>>} */
const byLicense = JSON.parse(raw);

const violations = [];
const unknown = [];

for (const [license, packages] of Object.entries(byLicense)) {
  const names = packages.map(
    (pkg) => `${pkg.name}${pkg.versions ? `@${pkg.versions.join(",")}` : ""}`,
  );
  if (license === "Unknown") {
    unknown.push(...names);
    continue;
  }
  if (!isExpressionAllowed(license)) {
    violations.push({ license, names });
  }
}

if (unknown.length > 0) {
  console.warn(
    `⚠️  ${unknown.length} package(s) report an Unknown license (not a failure): ${unknown.join(", ")}`,
  );
}

if (violations.length > 0) {
  console.error("✖ Forbidden dependency licenses found:");
  for (const { license, names } of violations) {
    console.error(`  ${license}: ${names.join(", ")}`);
  }
  console.error(
    "\nThese license families are not allowed. Remove the dependency or find a compatible alternative.",
  );
  process.exit(1);
}

console.log("✓ All dependency licenses are within policy.");
