# ADR 0002: Privacy-safe release observability

## Status

Accepted

## What Changed

Production observability uses Vercel Speed Insights for field Web Vitals and emits structured
application events through Vercel Runtime Logs. Application events are a strict allowlist of Web
Vital values and error classes, enriched with release, environment, feature, and trust; they never
contain diagram or project content, user text, headers, concrete URLs, query strings, arbitrary
messages, or stacks. Speed Insights strips URLs to their pathname before sending them.

Browser application events cross a same-origin endpoint in a bounded, schema-validated envelope.
The server issues an HMAC token bound to the active release, verifies that token and browser fetch
metadata at ingest, and labels accepted records `anonymous-client`. Server instrumentation emits
separate `server`-trust records from route templates. Production emits no application telemetry
without an explicit release identity and a configured ingest secret.

## Why

The editor handles potentially sensitive architecture diagrams and user-authored text, so copying
ordinary exceptions or request details into telemetry would create an unnecessary content channel.
At the same time, release decisions need real-user performance data and enough trusted error signal
to associate regressions with a deployment. The allowlist keeps content out by construction, while
release binding prevents stale or altered anonymous browser envelopes from being accepted as data
for the current release. Vercel Speed Insights supplies the hosted Web Vitals view already aligned
with the deployment platform; Runtime Logs preserve one structured application-event path for the
activated drain and alert backend.

## Alternatives Considered

- **Send standard exception payloads to a client error SDK:** Rejected because messages, stacks,
  breadcrumbs, and URLs can contain diagram content or user text, and redacting them after capture
  makes the privacy boundary harder to verify.
- **Trust same-origin checks without signing browser events:** Rejected because origin and fetch
  metadata do not prove that an envelope was issued for the active release or remained unaltered.
- **Build a custom Web Vitals dashboard from application logs:** Rejected because it duplicates the
  platform's percentile and route views and increases the operational surface. Application logs
  remain useful for the deliberately smaller error and release-correlation schema.

## Impact

Operators must activate Speed Insights, a Runtime Log drain or integration, alert destinations,
the ingest Firewall rule, and a production-only `OBSERVABILITY_INGEST_SECRET` before promotion.
Anonymous client trends must be corroborated with Speed Insights, a trusted server record, a smoke
failure, or another authenticated signal before rollback. Adding a telemetry field requires an
explicit schema and privacy review; arbitrary diagnostic content does not belong in this channel.
