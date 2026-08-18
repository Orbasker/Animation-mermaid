import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { measureJavaScriptAssets } from "./check-client-assets.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("production client asset measurement", () => {
  it("measures emitted JavaScript recursively without depending on chunk names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ani-21-assets-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "a.js"), "12345");
    await writeFile(join(directory, "nested", "b.js"), "1234567");
    await writeFile(join(directory, "nested", "styles.css"), "ignored");

    await expect(measureJavaScriptAssets(directory)).resolves.toEqual({
      fileCount: 2,
      largestBytes: 7,
      totalBytes: 12,
    });
  });

  it("fails when a build emits no JavaScript", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ani-21-assets-"));
    temporaryDirectories.push(directory);

    await expect(measureJavaScriptAssets(directory)).rejects.toThrow(
      "No JavaScript assets",
    );
  });
});
