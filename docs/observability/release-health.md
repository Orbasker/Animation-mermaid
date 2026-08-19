# Release health and go/no-go

Owner: **@Orbasker**. Complete the [activation contract](./activation.md) before promotion and
observe the active production release for 30 minutes afterward. The release identifier is
`OBSERVABILITY_RELEASE`, `VERCEL_GIT_COMMIT_SHA`, or `VERCEL_DEPLOYMENT_ID`, in that order. A
production deployment without one emits no application telemetry and is a no-go.

Open `OBSERVABILITY_DASHBOARD_URL` for Vercel Speed Insights and
`OBSERVABILITY_ALERTS_URL` for the activated log-drain/monitor backend. Vercel Runtime Logs are a
diagnostic event stream, not a percentile dashboard or alert engine.

| Signal             | Supported surface                                                                               | Go threshold                                                                                                     | No-go threshold                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Web Vitals         | Vercel Speed Insights, production environment, `/editor`, active time window                    | p75 LCP ≤ 2,500 ms, INP ≤ 200 ms, CLS ≤ 0.1 once each has at least 20 samples                                    | A populated metric exceeds its threshold in two consecutive 5-minute windows                                                       |
| Application errors | Activated log-drain monitor, grouped by `release`, `feature`, `trust`, `type`, and `errorClass` | No trusted server error during smoke; anonymous-client error trend does not regress against the previous release | Any smoke-correlated `trust=server` error, or an anonymous-client trend corroborated by smoke/Speed Insights/authenticated signals |
| Workflow and Eve   | Vercel Workflow runs and Observability Agent Runs                                               | Smoke run completes and correlated steps progress                                                                | Three failures in 10 minutes, >5% failure with 20 starts, or one non-waiting run stuck 15 minutes                                  |
| AI Gateway         | AI Gateway Observability, `feature:design-review`, `env:production`                             | Error rate ≤ 5%, p95 latency ≤ 30 seconds, run cost ≤ $0.50                                                      | Any activated alert-policy threshold is crossed                                                                                    |
| Health and smoke   | Health endpoint and production smoke runbook                                                    | Health is 2xx and all smoke steps pass                                                                           | Non-2xx health or any smoke step fails                                                                                             |

Low traffic below the 20-sample floor is not itself a failure. Keep observing and require health,
smoke, Workflow, Eve, AI Gateway, and activated monitor checks to pass.

Go only when every activation attestation is true, both stable links open, every populated
threshold is green, health and smoke pass, and no required monitor is firing. Record the release
identifier and decision time. Roll back immediately on a no-go threshold using the
[production smoke and rollback runbook](../runbooks/production-smoke-and-rollback.md).
