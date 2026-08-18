import { randomUUID } from "node:crypto";

import { defineTool } from "eve/tools";
import { z } from "zod";

const severity = z.enum(["blocker", "major", "minor", "nit"]);

const finding = z.object({
  area: z
    .string()
    .min(1)
    .describe(
      "The part of the design the finding is about, e.g. 'node contrast'.",
    ),
  severity,
  recommendation: z
    .string()
    .min(1)
    .describe("A concrete, actionable fix for the finding."),
});

const inputSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("One-paragraph overall assessment of the design."),
  verdict: z
    .enum(["approve", "approve_with_changes", "request_changes"])
    .describe("The overall review outcome."),
  findings: z
    .array(finding)
    .describe("Individual findings, most severe first."),
});

const outputSchema = z.object({
  reviewId: z.string(),
  reviewedAt: z.string(),
  verdict: inputSchema.shape.verdict,
  summary: z.string(),
  findings: z.array(finding),
  severityCounts: z.object({
    blocker: z.number().int(),
    major: z.number().int(),
    minor: z.number().int(),
    nit: z.number().int(),
  }),
});

export default defineTool({
  description:
    "Record the structured verdict of a design review. Call exactly once per review with the summary, an overall verdict, and the findings.",
  inputSchema,
  outputSchema,
  async execute({ summary, verdict, findings }) {
    const severityCounts = { blocker: 0, major: 0, minor: 0, nit: 0 };
    for (const { severity: level } of findings) {
      severityCounts[level] += 1;
    }

    return {
      reviewId: randomUUID(),
      reviewedAt: new Date().toISOString(),
      verdict,
      summary,
      findings,
      severityCounts,
    };
  },
});
