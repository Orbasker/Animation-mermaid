"use client";

import { SpeedInsights as VercelSpeedInsights } from "@vercel/speed-insights/next";

type SpeedInsightEvent = {
  readonly type: "vital";
  readonly url: string;
  readonly route?: string;
};

export function redactSpeedInsightEvent(
  event: SpeedInsightEvent,
): SpeedInsightEvent | null {
  try {
    return {
      ...event,
      url: new URL(event.url, window.location.origin).pathname,
    };
  } catch {
    return null;
  }
}

export function SpeedInsights() {
  return <VercelSpeedInsights beforeSend={redactSpeedInsightEvent} />;
}
