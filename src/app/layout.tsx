import type { Metadata } from "next";
import type { ReactNode } from "react";

import { WebVitals } from "@/app/_components/web-vitals";
import { SpeedInsights } from "@/app/_components/speed-insights";
import { deploymentIdentity } from "@/observability/deployment";
import { issueTelemetryToken } from "@/observability/integrity";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Animation Mermaid",
    template: "%s | Animation Mermaid",
  },
  description: "Turn Mermaid diagrams into clear, shareable animations.",
};

/**
 * Render every route dynamically so the per-request nonce that `proxy.ts` places in the
 * Content Security Policy is stamped onto Next.js's scripts at render time. A statically
 * generated shell would ship without that nonce and be blocked by the strict `script-src`.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const deployment = deploymentIdentity();
  const observabilityToken = deployment
    ? issueTelemetryToken(deployment)
    : null;

  return (
    <html lang="en">
      <head>
        {observabilityToken ? (
          <meta name="observability-token" content={observabilityToken} />
        ) : null}
      </head>
      <body>
        <WebVitals />
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
