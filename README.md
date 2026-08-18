# Animation Mermaid

Animation Mermaid is a Next.js application for turning Mermaid diagrams into clear,
shareable animations. The repository currently provides the application foundation, a
product-oriented home page, and an `/editor` placeholder for the upcoming editing
workspace.

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

Open [http://localhost:3000](http://localhost:3000). The editor placeholder is at
[http://localhost:3000/editor](http://localhost:3000/editor).

## Required checks

Run all four checks before opening or merging a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The checks cover ESLint, strict TypeScript validation, behavioral tests, and the
production Next.js build.

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
