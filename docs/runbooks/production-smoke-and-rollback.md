# Production smoke & rollback

How to verify the design-review journey on a Vercel Preview Deployment before promoting it, run
a production smoke after promotion, and roll back if the smoke fails.

The automated suite (`pnpm test`, `pnpm test:e2e`, and `pnpm test:performance`) is the primary gate
and runs in CI on every PR. This runbook covers the manual verification the automated suite cannot do: that the real
Web → API → Queue → Worker → Database path works end-to-end against a deployed environment with the
live AI agent, not the deterministic fixture.

## 1. Verify a Preview Deployment

Every PR gets a Vercel Preview URL. The required CI checks (`quality`, `build`, `e2e`, and
`performance`) must be green before merge — they gate the PR.

On the Preview URL, walk the journey once by hand:

1. Open `/editor`. The sample architecture loads and the **Source** surface shows the imported
   Mermaid intact.
2. Move a component (arrow keys) and reload — the position persists (IndexedDB, per browser
   profile).
3. **Story** surface → _Enter preview_ → scrub the timeline; the playhead seeks to an arbitrary
   position and the canvas reflects it.
4. **Compare** surface shows the semantic diff.
5. **Copilot** surface → compose an intent → _Preview request_. Confirm the context preview lists
   only the components you kept — this is the consent boundary. Nothing is sent before _Confirm &
   generate_.
6. _Confirm & generate_. A real run starts against the eve agent through the AI Gateway. Watch
   progress stream in.
7. **Reload mid-run.** The editor reconnects to the same run by id (not a second run) and shows the
   proposal at the approval gate.
8. _Apply to project_ applies the story as one undoable transaction; _Undo apply_ reverts it byte
   for byte. Discarding a proposal mutates nothing.

Preconditions for the live AI path on a deployment:

- `DESIGN_REVIEW_STORY_AGENT` is **unset** (the fixture transport refuses to run when
  `VERCEL_ENV=production`; leaving it set on preview yields deterministic canned scenes).
- The AI Gateway credential / budget is configured for the environment.

## 2. Promote to production

Complete the [observability activation contract](../observability/activation.md). Promotion is
blocked if any activation attestation, stable dashboard/alert link, monitor notification test,
Firewall rule, or ingest secret is missing.

Promote the verified Preview deployment to production (Vercel dashboard → the deployment →
_Promote to Production_, or `vercel promote <deployment-url>`).

## 3. Production smoke

Immediately after promotion, on the production URL, run the shortened smoke:

1. `/editor` loads; Source, Story, and Compare surfaces render.
2. A move persists across a reload.
3. Copilot → compose → preview → _Confirm & generate_ starts a real run and streams progress.
4. Reload reconnects to the in-flight run.
5. Approve applies; undo reverts.

If all five pass, the promotion is good.

Open `OBSERVABILITY_DASHBOARD_URL`, `OBSERVABILITY_ALERTS_URL`, and the
[release health checklist](../observability/release-health.md), then observe the active
release for 30 minutes. The smoke is complete only when its health, errors, Web Vitals,
Workflow/Eve, and AI Gateway checks are green. Alert ownership and thresholds are defined in the
[production alert policy](../observability/alert-policy.md).

## 4. Rollback

If the smoke or any release-health no-go check fails, roll back before investigating:

- **Vercel dashboard:** Deployments → the previous known-good production deployment →
  _Promote to Production_ (instant alias swap, no rebuild).
- **CLI:** `vercel rollback` (or `vercel promote <previous-good-url>`).

Rollback is an alias swap and takes effect in seconds. No client data is at risk: projects are
local-first in the browser's IndexedDB and are never uploaded during editing, so a rollback cannot
lose a user's work. In-flight AI runs are durable and addressed by id; a rolled-back deployment can
still reconnect to a run started against the previous one.

After rollback, capture the failing smoke step and the Preview URL that reproduced it, then open a
fix PR. Capture only the deployment/release identifier and safe error classification; do not paste
diagram content, user text, query-bearing URLs, arbitrary error messages, or stack traces into the
incident record. The same required checks gate the fix.
