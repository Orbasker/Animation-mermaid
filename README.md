# Animation Mermaid

Animation Mermaid is a Next.js application for turning Mermaid diagrams into clear,
shareable animations. Its local-first editor imports Mermaid architecture diagrams into
an interactive workspace where components can be arranged and explained visually.

## Visual graph editor

The `/editor` workspace keeps the imported Mermaid source intact while visual edits are
stored against stable semantic entity IDs. Users can select and drag components, move
them with the keyboard, create visual groups, hide or reveal components, add annotations,
and focus a selection without changing the source diagram.

The workspace includes Source, Story, Compare, Layers, and Inspector surfaces, plus
pan/zoom controls and undo/redo for graph mutations. Changes autosave to IndexedDB and
compatible positions and visual metadata are restored after reload or Mermaid reimport.
A built-in 200-component preview exercises the dense-graph interaction path without
overwriting the active project.

The visual-edit persistence boundary is documented in
[ADR 0001](docs/adr/0001-separate-visual-edits-from-semantic-graph.md).

## Local-first persistence

Projects are stored on the device in IndexedDB via `ProjectRepository`
(`src/persistence`). Editing never uploads a project document; the store keeps canonical,
portable content separate from local bookkeeping and from hosted AI run identifiers.

- **Autosave & recovery** — every write runs in a single IndexedDB transaction, so an
  interrupted write is rolled back and the store recovers to the last complete transaction.
- **Lifecycle** — `list`, `create`, `save`, `rename`, `duplicate`, `archive`/`unarchive`,
  `delete`.
- **Portable JSON** — `export` emits canonical document JSON (no metadata, no run ids) that
  `import` migrates forward, validates, and loads into a fresh browser profile.
- **Hosted AI runs** — `linkAiRun`/`aiRuns` record run identifiers in a separate object
  store, kept out of the exported document.

## Prerequisites

- Node.js matching `^22.22.2 || ^24.15.0 || >=26.0.0` (Node.js 24.15 or newer
  within the 24.x release line is recommended)
- pnpm 10 (the repository pins the expected version in `package.json`)
- A Vercel account and the Vercel CLI for linked environments and deployments

Enable the packaged pnpm version with Corepack if needed:

```bash
corepack enable
corepack prepare pnpm@10.30.0 --activate
```

## Local setup

Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The editor workspace is at
[http://localhost:3000/editor](http://localhost:3000/editor).

## Required checks

Continuous integration runs the exact commands below on every pull request, so
run them locally before opening or merging one:

```bash
pnpm install --frozen-lockfile   # lockfile must be committed and in sync
pnpm format:check                # Prettier
pnpm lint                        # ESLint (incl. import boundaries + naming)
pnpm typecheck                   # strict TypeScript (tsc --noEmit)
pnpm test                        # unit + workflow integration tests
pnpm build                       # production Next.js build
```

Fix formatting automatically with `pnpm format`. Merge into `main` is blocked
until every required check passes; direct pushes to `main` are not allowed.

`pnpm test` runs two suites, which can also be run on their own:

- `pnpm test:unit` — the default Vitest project (jsdom).
- `pnpm test:integration` — `*.integration.test.ts`, run through the Workflow
  DevKit's Vitest plugin, which compiles the workflow directives and executes
  runs against an in-process runtime. No server and no model call is needed.

The full end-to-end journey (`pnpm test:e2e`, Playwright) also runs in CI.

## Repository standards and security

- Pull requests and issues use the templates under
  [`.github/`](.github); see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full
  workflow and branch/PR conventions.
- CI additionally runs secret scanning (gitleaks, with a self-test that proves
  it rejects a planted credential), dependency review and audit, and a
  dependency **license policy** check (`pnpm license:check`).
- Report vulnerabilities privately — see [`SECURITY.md`](SECURITY.md).

## AI agent foundation

The repository ships a filesystem-first [eve](https://eve.dev) agent — a typed
design-review agent — mounted into the Next.js app. `next.config.ts` wraps the
config in `withEve()`, so the agent and the web app run from one dev server and
deploy as one Vercel project.

The agent lives under `agent/`:

- `agent.ts` — model, reasoning effort, and AI Gateway usage tags
  (`feature:design-review`, `env:<environment>`). The model is a Gateway catalog
  slug; override it with `AI_GATEWAY_MODEL` to track the current catalog.
- `instructions.md` — the design-review system prompt.
- `tools/record_design_review.ts` — a typed tool with Zod input **and** output
  schemas; eve validates both at runtime.
- `skills/design-review-checklist/` — a load-on-demand review checklist.
- `instrumentation.ts` — OpenTelemetry registration plus per-step `feature`/`env`
  span context, so a run is identifiable in Vercel Agent Runs and Gateway traces.

Evaluation fixtures live under `evals/`. `smoke.eval.ts` is the typed smoke
prompt: it drives one review turn and asserts the run succeeded and recorded a
schema-valid verdict.

### Model authentication (AI Gateway, OIDC)

The agent routes model calls through the Vercel AI Gateway using OIDC — no
provider API key. After linking the project (see below), pull the token:

```bash
vercel env pull .env.local --yes   # writes a short-lived VERCEL_OIDC_TOKEN (~24h)
```

Re-run it when the token expires. `.env.local` is git-ignored; never commit it.
See `.env.example` for the environment-shaped names and safe placeholders.

### Run the agent and the smoke prompt

```bash
pnpm dev            # Next.js app + eve agent from one dev server
pnpm agent:info     # inspect the discovered agent surface
pnpm agent:eval     # run the smoke eval against a local server
```

Target a Preview Deployment instead of a local server with the deployment URL:

```bash
pnpm agent:eval --url https://<preview-deployment-url>
```

Both the Gateway traces (filtered by the `feature:`/`env:` tags) and the Vercel
**Observability → Agent Runs** tab identify the smoke run.

## Design-review story workflow

`generateDesignReviewStory` (`src/workflows/design-review-story`) proposes an
animated design-review narrative for a diagram and pauses for human approval
before returning anything applicable. It is built with the
[Workflow DevKit](https://useworkflow.dev): `next.config.ts` wraps the config in
`withWorkflow()` alongside `withEve()`, so the app, the agent, and the workflow
runtime deploy as one Vercel project.

The split of responsibility is deliberate:

- **eve owns agent behavior** — the model, the instructions, the
  `design-review-storyboard` skill, and the conversational state behind an eve
  session. The workflow asks one bounded, schema-checked question per step and
  threads the eve session id between them.
- **Workflow DevKit owns orchestration** — the order of those questions, the
  retry budget for each, the human approval gate, and the durability that lets a
  run outlive the request that started it.

### Shape of a run

| Phase                 | What happens                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validating-context`  | The `AgentContextPackage` is parsed against a strict schema. An extra key — a layout coordinate, a renderer handle — fails the run rather than reaching the model. Invalid input is fatal, never retried. |
| `analyzing-narrative` | The agent proposes a thesis, an audience, and ordered beats.                                                                                                                                              |
| `generating-scenes`   | The agent drafts scenes from those beats.                                                                                                                                                                 |
| `critiquing`          | The agent reviews its own draft.                                                                                                                                                                          |
| —                     | Scenes are assembled into a `Story` and validated with the project's own `validateStory`, so a proposal that reaches a caller is already known to apply cleanly.                                          |
| `awaiting-approval`   | The run suspends — consuming nothing — until a human decides.                                                                                                                                             |
| `settled`             | Approval returns the proposal; rejection returns an outcome with no proposal in it.                                                                                                                       |

Each agent step retries transient failures (timeouts, rate limits, upstream 5xx)
up to three times; a request the agent rejects outright is not retried. Because
each step's result is recorded once, a retried scene draft never re-runs the
narrative analysis before it.

Nothing in the workflow writes to a project. Persistence stays local-first and
client-owned, so a rejected proposal leaves nothing to undo, and only the
`approved` outcome carries a payload a client could apply.

### Streams and reconnecting

The workflow run id is the durable handle. Progress notes go to a named
`progress` stream and the settled outcome to the default one, so a client can
replay one without the other.

| Endpoint                                         | Purpose                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/design-review-story`                  | Start a run; returns `runId` (also in `x-workflow-run-id`).                                                                                                                          |
| `GET /api/design-review-story/{runId}`           | Status, plus the outcome once it settles — or a classified `error` message when the run has `failed`.                                                                                |
| `GET /api/design-review-story/{runId}/progress`  | Replay the progress stream. `?startIndex=` resumes from a known chunk; negative values count back from the end, resolved against the `x-workflow-stream-tail-index` response header. |
| `GET /api/design-review-story/{runId}/proposal`  | Read the proposal a suspended run is waiting on, so a reviewer can see the scenes before deciding. `425` until the gate is reached. Seeing the proposal is not applying it.          |
| `POST /api/design-review-story/{runId}/decision` | Submit `{"decision":"approve"\|"reject"}`. A run that already settled answers `409`.                                                                                                 |
| `DELETE /api/design-review-story/{runId}`        | Cancel a run before it settles.                                                                                                                                                      |

A client that reloads keeps only the run id, re-reads status, and replays
progress from where it left off — the run itself was never held open by the
connection.

Approval returns a deterministic payload: scene ids come from ordinal position
and the story and proposal ids are content-addressed over the story itself, so
two runs of the same request produce an identical proposal.

### Reviewing and applying proposals in the editor

The `/editor` workspace has an **AI copilot** surface that drives a run end to end
and applies an accepted proposal to the local project. It is built to make the
review safe rather than fast:

- **Confirmed context, never a surprise.** You write the intent, then see and edit
  the exact semantic package that will be sent — every component is a checkbox, and
  unchecked ones (and any edge or group member that referenced them) are pruned from
  the request, not merely hidden. No request starts until you confirm that preview.
- **Durable, reconnectable runs.** Starting a run links its id to the project's
  separate run store, so a reload rejoins the run in flight — progress, proposal, and
  approval gate intact — rather than starting a second one. Runs can be cancelled and,
  after a failure, started over.
- **Review before applying.** At the approval gate the copilot reads the published
  proposal and shows the thesis, the agent's self-critique, and a scene-by-scene diff
  of what it would animate against your local snapshot — before you decide.
- **One undoable transaction.** Applying an approved proposal adds the story as a
  single change with its own undo/redo; applying the same content-addressed proposal
  twice is a no-op. Discarding leaves the document byte-for-byte unchanged.
- **Actionable failures.** Gateway budget, rate-limit, and provider errors are
  classified from the run's recorded failure into one clear next action, and your
  local work is never touched.

The copilot talks to the endpoints above through a small `CopilotTransport`
seam (`src/app/editor/ai-copilot`), so the whole flow is driven by a scripted
transport in tests with no workflow runtime.

### Running it locally without a model

Set the fixture agent to drive the whole flow deterministically — useful for
seeing the endpoints work before wiring a Gateway credential:

```bash
DESIGN_REVIEW_STORY_AGENT=fixture pnpm dev
```

It is refused when `VERCEL_ENV=production`. `DESIGN_REVIEW_STORY_AGENT_SCRIPT`
scripts its failures and output; see `.env.example`.

### Observing a run

```bash
npx workflow web                 # dashboard for local runs
npx workflow inspect runs        # or the terminal equivalent
npx workflow inspect run <run-id> --backend vercel --project <project> --team <team>
```

Deployed runs appear under Vercel **Observability → Workflows**, and the eve
turns behind them under **Agent Runs**. An approved or rejected outcome carries
`agentSessionId`, which is the eve session the narrative came from — that is the
join between the two views.

## Vercel project setup

Authenticate with the Vercel CLI, then link your local checkout to the intended project:

```bash
vercel login
vercel link
```

Pull the linked Development environment into a local-only file:

```bash
vercel env pull .env.local --yes
```

If a Vercel integration supplies a short-lived OIDC credential, rerun the same
`vercel env pull .env.local --yes` command when the credential expires or before a new
local session that needs it. Never copy a stale OIDC value between machines or commit it.

## Deployment flow

The Vercel Git integration is the source of truth for deployments:

- Push a non-`main` branch to create a Preview deployment for review.
- Merge to and push `main` only after all required checks pass; `main` creates the
  Production deployment.
- Verify the branch and target environment in Vercel before promoting or inspecting a
  deployment.

Do not run production deployments from feature branches. This repository does not need
provider access tokens or Vercel access tokens in source control. Keep provider secrets,
Vercel tokens, and pulled environment values in ignored `.env*` files or in Vercel's
encrypted environment settings. `.env.example` is the only environment-shaped file that
may be committed, and it must contain names and safe placeholders only.
