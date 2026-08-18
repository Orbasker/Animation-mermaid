# Production smoke & rollback

How to verify the design-review journey on a Vercel Preview Deployment before promoting it, run
a production smoke after promotion, and roll back if the smoke fails.

The automated suite (`pnpm test` and `pnpm test:e2e`) is the primary gate and runs in CI on every
PR. This runbook covers the manual verification the automated suite cannot do: that the real
Web → API → Queue → Worker → Database path works end-to-end against a deployed environment with the
live AI agent, not the deterministic fixture.

## 1. Verify a Preview Deployment

Every PR gets a Vercel Preview URL. The required CI checks (`quality`, `e2e`) must be green before
merge — they gate the PR.

On the Preview URL, walk the journey once by hand:

1. Open `/editor`. The sample architecture loads and the **Source** surface shows the imported
   Mermaid intact.
2. Move a component (arrow keys) and reload — the position persists (IndexedDB, per browser
   profile).
3. **Story** surface → *Enter preview* → scrub the timeline; the playhead seeks to an arbitrary
   position and the canvas reflects it.
4. **Compare** surface shows the semantic diff.
5. **Copilot** surface → compose an intent → *Preview request*. Confirm the context preview lists
   only the components you kept — this is the consent boundary. Nothing is sent before *Confirm &
   generate*.
6. *Confirm & generate*. A real run starts against the eve agent through the AI Gateway. Watch
   progress stream in.
7. **Reload mid-run.** The editor reconnects to the same run by id (not a second run) and shows the
   proposal at the approval gate.
8. *Apply to project* applies the story as one undoable transaction; *Undo apply* reverts it byte
   for byte. Discarding a proposal mutates nothing.

Preconditions for the live AI path on a deployment:

- `DESIGN_REVIEW_STORY_AGENT` is **unset** (the fixture transport refuses to run when
  `VERCEL_ENV=production`; leaving it set on preview yields deterministic canned scenes).
- The AI Gateway credential / budget is configured for the environment.

## 2. Promote to production

Promote the verified Preview deployment to production (Vercel dashboard → the deployment →
*Promote to Production*, or `vercel promote <deployment-url>`).

## 3. Production smoke

Immediately after promotion, on the production URL, run the shortened smoke:

1. `/editor` loads; Source, Story, and Compare surfaces render.
2. A move persists across a reload.
3. Copilot → compose → preview → *Confirm & generate* starts a real run and streams progress.
4. Reload reconnects to the in-flight run.
5. Approve applies; undo reverts.

If all five pass, the promotion is good.

## 4. Rollback

If the smoke fails, roll back before investigating:

- **Vercel dashboard:** Deployments → the previous known-good production deployment →
  *Promote to Production* (instant alias swap, no rebuild).
- **CLI:** `vercel rollback` (or `vercel promote <previous-good-url>`).

Rollback is an alias swap and takes effect in seconds. No client data is at risk: projects are
local-first in the browser's IndexedDB and are never uploaded during editing, so a rollback cannot
lose a user's work. In-flight AI runs are durable and addressed by id; a rolled-back deployment can
still reconnect to a run started against the previous one.

After rollback, capture the failing smoke step and the Preview URL that reproduced it, then open a
fix PR — the same required checks gate its merge.
