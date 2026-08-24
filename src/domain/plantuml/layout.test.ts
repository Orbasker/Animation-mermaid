import { describe, expect, it } from "vitest";

import { snapshotId } from "@/domain/graph";
import { ACCEPTANCE_PLANTUML } from "@/domain/plantuml/fixtures";
import { importPlantuml } from "@/domain/plantuml/import";
import { layoutPlantuml } from "@/domain/plantuml/layout";

function importedSnapshot() {
  return importPlantuml({
    text: ACCEPTANCE_PLANTUML,
    snapshotId: snapshotId("snap-uml"),
    importedAt: "2026-08-24T00:00:00.000Z",
  }).snapshot!;
}

describe("layoutPlantuml", () => {
  it("positions every node and container through the shared engine", async () => {
    const snapshot = importedSnapshot();
    const hints = await layoutPlantuml(snapshot);
    const positioned = new Set(hints.map((h) => h.entityId as string));
    for (const id of ["browser", "cdn", "api", "orders", "db", "web", "app"]) {
      expect(positioned.has(id)).toBe(true);
    }
    for (const hint of hints) {
      expect(Number.isFinite(hint.x)).toBe(true);
      expect(Number.isFinite(hint.y)).toBe(true);
    }
  });

  it("keeps a packaged node inside its container bounds", async () => {
    const snapshot = importedSnapshot();
    const hints = await layoutPlantuml(snapshot);
    const byId = new Map(hints.map((h) => [h.entityId as string, h]));
    const web = byId.get("web")!;
    const browser = byId.get("browser")!;
    expect(browser.x).toBeGreaterThanOrEqual(web.x);
    expect(browser.y).toBeGreaterThanOrEqual(web.y);
  });

  it("is deterministic across runs", async () => {
    const snapshot = importedSnapshot();
    const a = await layoutPlantuml(snapshot);
    const b = await layoutPlantuml(snapshot);
    expect(a).toEqual(b);
  });
});
