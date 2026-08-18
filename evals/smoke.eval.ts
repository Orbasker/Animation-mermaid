import { defineEval } from "eve/evals";

const VERDICTS = new Set([
  "approve",
  "approve_with_changes",
  "request_changes",
]);

/**
 * Shape check for the schema-validated `record_design_review` output. eve
 * enforces the tool's Zod `outputSchema` at runtime; this mirrors the contract
 * so the smoke run fails loudly if the tool ever returns something off-schema.
 */
function isReviewRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.reviewId === "string" &&
    typeof record.reviewedAt === "string" &&
    typeof record.verdict === "string" &&
    VERDICTS.has(record.verdict) &&
    Array.isArray(record.findings) &&
    typeof record.severityCounts === "object" &&
    record.severityCounts !== null
  );
}

export default defineEval({
  description:
    "Smoke test: the design-review agent runs a review end-to-end and records a schema-valid verdict.",
  async test(t) {
    await t.send(
      "Review this design: the editor's export button opens a modal with a single " +
        "'Export' action and no format choice, no progress indicator, and no way to " +
        "cancel a long render. Audience is first-time users.",
    );

    t.succeeded();
    t.calledTool("record_design_review", {
      count: 1,
      output: (value) => isReviewRecord(value),
    });
  },
});
