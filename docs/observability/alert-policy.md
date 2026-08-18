# Production alert policy

Owner: **@Orbasker**. These definitions must be activated in the approved log-drain/monitor backend
and linked by `OBSERVABILITY_ALERTS_URL`. Runtime Logs can inspect individual JSON records but do
not calculate these windows or send threshold notifications. Follow the
[activation contract](./activation.md); do not claim readiness from this checked-in policy alone.

| Monitor                | Source and filter                                                                   | Trigger                                                                                  | First response                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Trusted server errors  | Drained Runtime Logs; `environment=production`, `trust=server`, `type=server_error` | Any record during release smoke or 3 records in 5 minutes for one release/feature        | Correlate with smoke and release; roll back if introduced by the active release             |
| Anonymous client trend | Drained Runtime Logs; `trust=anonymous-client`, grouped by release and error class  | 5 records in 5 minutes and at least twice the previous release baseline                  | Corroborate with Speed Insights, smoke, or an authenticated signal before rollback          |
| Workflow failures      | Vercel Workflow runs for `generateDesignReviewStory`                                | 3 failures in 10 minutes or >5% over 30 minutes with 20 starts                           | Inspect the Workflow run, Agent Run, and AI Gateway before retrying                         |
| Workflow stuck         | Non-waiting run with no step transition                                             | One run exceeds 15 minutes                                                               | Exclude intentional approval/session waits, then inspect the latest step                    |
| AI Gateway degradation | AI Gateway Observability; `feature:design-review`, `env:production`                 | Error rate >5% with 20 calls, p95 latency >30 seconds for 15 minutes, or run cost >$0.50 | Inspect provider/model and correlated Agent Runs; roll back a release-correlated regression |

Application records are an allowlist. Never drain diagram/project content, user text, headers,
concrete URLs, query strings, arbitrary messages, stacks, or telemetry tokens. Route templates and
pathname-only Speed Insights URLs are permitted.
