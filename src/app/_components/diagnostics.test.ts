import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDiagnostics,
  copyToClipboard,
  detectCapabilities,
  formatDiagnostics,
} from "./diagnostics";

describe("buildDiagnostics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures the error identity without any project contents", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    const diagnostics = buildDiagnostics({
      scope: "editor",
      error,
      projectSummary: { snapshots: 2, nodes: 12, edges: 9, stories: 1 },
    });

    expect(diagnostics.scope).toBe("editor");
    expect(diagnostics.error).toEqual({
      name: "Error",
      message: "boom",
      digest: "abc123",
    });
    expect(diagnostics.projectSummary).toEqual({
      snapshots: 2,
      nodes: 12,
      edges: 9,
      stories: 1,
    });

    const text = formatDiagnostics(diagnostics);
    // Counts are fine; nothing that could be diagram source or labels.
    expect(text).toContain('"nodes": 12');
    expect(text).not.toMatch(/source|annotation|label/i);
  });

  it("omits optional fields when no error or summary is given", () => {
    const diagnostics = buildDiagnostics({ scope: "app" });
    expect(diagnostics.error).toBeUndefined();
    expect(diagnostics.projectSummary).toBeUndefined();
    expect(typeof diagnostics.capturedAt).toBe("string");
  });

  it("reports offline status from the navigator", () => {
    vi.stubGlobal("navigator", { onLine: false, userAgent: "test-agent" });
    const diagnostics = buildDiagnostics({ scope: "app" });
    expect(diagnostics.online).toBe(false);
    expect(diagnostics.userAgent).toBe("test-agent");
  });
});

describe("detectCapabilities", () => {
  it("returns a boolean for every probed feature", () => {
    const capabilities = detectCapabilities();
    expect(typeof capabilities.indexedDB).toBe("boolean");
    expect(typeof capabilities.webWorker).toBe("boolean");
    expect(typeof capabilities.cryptoRandomUUID).toBe("boolean");
    expect(typeof capabilities.clipboard).toBe("boolean");
  });
});

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the async clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the async API rejects", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
