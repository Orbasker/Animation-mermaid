import { z } from "zod";

const errorClassSchema = z.enum([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "AggregateError",
  "NonError",
]);

const clientErrorEventSchema = z
  .object({
    type: z.literal("client_error"),
    source: z.enum(["window", "unhandled_rejection"]),
    errorClass: errorClassSchema,
  })
  .strict();

const webVitalBase = {
  type: z.literal("web_vital"),
  rating: z.enum(["good", "needs-improvement", "poor"]),
  navigationType: z.enum([
    "navigate",
    "reload",
    "prerender",
    "back-forward",
    "back-forward-cache",
    "restore",
  ]),
} as const;

function durationMetric(name: "TTFB" | "FCP" | "LCP" | "FID" | "INP") {
  return z
    .object({
      ...webVitalBase,
      name: z.literal(name),
      value: z.number().finite().min(0).max(120_000),
      delta: z.number().finite().min(0).max(120_000),
    })
    .strict();
}

const clsMetric = z
  .object({
    ...webVitalBase,
    name: z.literal("CLS"),
    value: z.number().finite().min(0).max(100),
    delta: z.number().finite().min(0).max(100),
  })
  .strict();

const webVitalEventSchema = z.discriminatedUnion("name", [
  durationMetric("TTFB"),
  durationMetric("FCP"),
  durationMetric("LCP"),
  durationMetric("FID"),
  clsMetric,
  durationMetric("INP"),
]);

export const clientObservabilityEventSchema = z.discriminatedUnion("type", [
  clientErrorEventSchema,
  webVitalEventSchema,
]);

export const clientObservabilityEnvelopeSchema = z
  .object({
    token: z.string().min(1).max(512),
    event: clientObservabilityEventSchema,
  })
  .strict();
