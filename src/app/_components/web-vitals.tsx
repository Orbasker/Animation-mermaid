"use client";

import { useReportWebVitals } from "next/web-vitals";

import { reportClientObservabilityEvent } from "@/observability/client";
import { createWebVitalEvent } from "@/observability/events";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

const reportWebVital: ReportWebVitalsCallback = (metric) => {
  reportClientObservabilityEvent(createWebVitalEvent(metric));
};

export function WebVitals() {
  useReportWebVitals(reportWebVital);
  return null;
}
