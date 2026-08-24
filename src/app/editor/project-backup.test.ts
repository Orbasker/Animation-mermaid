import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sampleProjectDocument } from "@/domain/fixtures";

import {
  clearProjectBackup,
  downloadProjectBackup,
  readProjectBackup,
  recordProjectBackup,
  summarizeProject,
} from "./project-backup";

describe("project backup store", () => {
  beforeEach(() => {
    clearProjectBackup();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records and reads back the latest project", () => {
    const project = sampleProjectDocument();
    recordProjectBackup(project);

    const record = readProjectBackup();
    expect(record?.project.id).toBe(project.id);
    expect(typeof record?.savedAt).toBe("string");
  });

  it("survives a module reset by reading from sessionStorage", () => {
    const project = sampleProjectDocument();
    recordProjectBackup(project);
    // Simulate a remount losing the in-memory singleton but not sessionStorage.
    clearInMemoryOnly();
    expect(readProjectBackup()?.project.id).toBe(project.id);
  });

  it("summarizes counts only, never contents", () => {
    const summary = summarizeProject(sampleProjectDocument());
    expect(summary.snapshots).toBeGreaterThan(0);
    expect(summary.nodes).toBeGreaterThan(0);
    expect(Object.keys(summary).sort()).toEqual([
      "edges",
      "nodes",
      "snapshots",
      "stories",
    ]);
  });

  it("downloads a JSON blob and returns true", () => {
    recordProjectBackup(sampleProjectDocument());
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation(
      () =>
        ({
          click,
          remove: vi.fn(),
          setAttribute: vi.fn(),
          style: {},
        }) as unknown as HTMLAnchorElement,
    );
    vi.spyOn(document.body, "appendChild").mockImplementation(
      ((node: Node) => node) as typeof document.body.appendChild,
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:x");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    expect(downloadProjectBackup()).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");

    vi.unstubAllGlobals();
  });

  it("returns false when there is nothing to download", () => {
    expect(downloadProjectBackup()).toBe(false);
  });
});

// Clears only the in-memory copy to prove the sessionStorage fallback path.
function clearInMemoryOnly() {
  const raw = sessionStorage.getItem("animation-mermaid:project-backup");
  clearProjectBackup();
  if (raw) sessionStorage.setItem("animation-mermaid:project-backup", raw);
}
