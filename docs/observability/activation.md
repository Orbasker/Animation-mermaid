# Observability activation contract

Owner: **@Orbasker**. This repository wires telemetry, but this workspace is not linked to a Vercel
project and does not provision dashboards, drains, Firewall rules, or notification destinations.
Production release readiness therefore fails until an operator completes and records every item
below for the actual project.

## Required activation

1. Enable Vercel Speed Insights for the production project. Deploy, visit `/editor`, navigate away
   or blur the tab, and verify a pathname-only `/editor` data point appears. Set
   `OBSERVABILITY_SPEED_INSIGHTS_ACTIVE=true` only after this smoke passes.
2. Configure an approved Vercel Log Drain or observability integration for Runtime Logs. Parse the
   emitted JSON records in that backend and activate the error monitors in
   [alert policy](./alert-policy.md). Set `OBSERVABILITY_ERROR_MONITOR_ACTIVE=true` only after a
   synthetic test notification reaches the on-call destination.
3. Activate a Vercel Firewall rate limit for `POST /api/observability`: 60 requests per minute per
   source, deny for 10 minutes when exceeded. Verify the 61st request is blocked without sending a
   real event payload, then set `OBSERVABILITY_FIREWALL_RATE_LIMIT_ACTIVE=true`.
4. Set `OBSERVABILITY_DASHBOARD_URL` to the stable Speed Insights production view and
   `OBSERVABILITY_ALERTS_URL` to the stable monitor/alert view. Placeholder, inaccessible, or
   release-specific links fail readiness.
5. Set a production-only `OBSERVABILITY_INGEST_SECRET` with at least 32 random bytes. Confirm the
   deployed page contains an `observability-token` meta tag and a same-origin event returns 204;
   an altered token must return 401.

## Release gate evidence

Before promotion, record the activation date, operator, project, the two stable links, Firewall
rule identifier, drain/integration identifier, notification test timestamp, and Speed Insights
smoke timestamp in the deployment note. If any required setting is false, missing, inaccessible,
or untested, the release decision is **no-go**. Checked-in code and Runtime Logs do not substitute
for activated external monitors.

Client records have `trust=anonymous-client`. The signed token prevents accepting altered or
cross-release envelopes, but it does not identify a user. Anonymous client counts alone never
trigger rollback; corroborate them with Speed Insights, a trusted `trust=server` record, a failed
smoke step, or another authenticated service signal.
