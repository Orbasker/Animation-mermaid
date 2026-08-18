// @vitest-environment node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./generate-sbom.mjs", import.meta.url));

const generate = (pnpmList: unknown): string =>
  execFileSync("node", [script, "--stdin"], {
    input: JSON.stringify(pnpmList),
    encoding: "utf8",
  });

const runWith = (pnpmList: unknown) => JSON.parse(generate(pnpmList));

const lib = (name: string, version: string) => ({
  type: "library",
  name,
  version,
  purl: `pkg:npm/${name.replace("@", "%40")}@${version}`,
});

const rootImporter = {
  name: "animation-mermaid",
  version: "0.1.0",
  private: true,
  dependencies: {
    "@vercel/otel": {
      version: "2.1.3",
      dependencies: { "@opentelemetry/api": { version: "1.9.0" } },
    },
    next: {
      version: "16.3.1",
      // Same package+version reached via a second path must not duplicate.
      dependencies: { "@vercel/otel": { version: "2.1.3" } },
    },
    zod: { version: "4.4.3" },
  },
  optionalDependencies: {
    fsevents: { version: "2.3.3" },
  },
};

describe("generate-sbom", () => {
  it("emits a CycloneDX 1.5 document rooted at the project component", () => {
    const sbom = runWith([rootImporter]);

    expect(sbom.bomFormat).toBe("CycloneDX");
    expect(sbom.specVersion).toBe("1.5");
    expect(sbom.metadata.component).toMatchObject({
      type: "application",
      name: "animation-mermaid",
      version: "0.1.0",
    });
  });

  it("flattens the closure, dedupes, and sorts deterministically", () => {
    const sbom = runWith([rootImporter]);

    expect(sbom.components).toEqual([
      lib("@opentelemetry/api", "1.9.0"),
      lib("@vercel/otel", "2.1.3"),
      lib("fsevents", "2.3.3"),
      lib("next", "16.3.1"),
      lib("zod", "4.4.3"),
    ]);
  });

  it("encodes the scope separator in the purl", () => {
    const sbom = runWith([rootImporter]);

    expect(sbom.components[0].purl).toBe("pkg:npm/%40opentelemetry/api@1.9.0");
  });

  it("is reproducible: identical input yields byte-identical output", () => {
    expect(generate([rootImporter])).toBe(generate([rootImporter]));
  });

  it("skips workspace links and entries that have no version", () => {
    const sbom = runWith([
      {
        name: "animation-mermaid",
        version: "0.1.0",
        dependencies: {
          "workspace-pkg": {},
          resolved: { version: "1.0.0" },
        },
      },
    ]);

    expect(sbom.components).toEqual([lib("resolved", "1.0.0")]);
  });
});
