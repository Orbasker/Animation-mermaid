import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return javascriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".js") ? [path] : [];
    }),
  );
  return nested.flat();
}

export async function measureJavaScriptAssets(directory) {
  const files = await javascriptFiles(directory);
  if (files.length === 0) {
    throw new Error(`No JavaScript assets found under ${directory}`);
  }
  const sizes = await Promise.all(
    files.map(async (file) => (await stat(file)).size),
  );
  return {
    fileCount: files.length,
    largestBytes: Math.max(...sizes),
    totalBytes: sizes.reduce((total, size) => total + size, 0),
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const budgets = JSON.parse(
    await readFile(join(root, "tools/performance-budgets.json"), "utf8"),
  );
  const measured = await measureJavaScriptAssets(
    join(root, ".next/static/chunks"),
  );

  console.log(
    `Client JavaScript: ${measured.totalBytes} bytes across ${measured.fileCount} files; largest ${measured.largestBytes} bytes.`,
  );

  const failures = [];
  if (measured.totalBytes > budgets.bundle.emittedJavaScriptBytes) {
    failures.push(
      `total ${measured.totalBytes} > ${budgets.bundle.emittedJavaScriptBytes}`,
    );
  }
  if (measured.largestBytes > budgets.bundle.largestJavaScriptChunkBytes) {
    failures.push(
      `largest ${measured.largestBytes} > ${budgets.bundle.largestJavaScriptChunkBytes}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Client asset budget exceeded: ${failures.join("; ")}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
