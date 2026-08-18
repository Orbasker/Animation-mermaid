# Animation Mermaid

Animation Mermaid is a Next.js application for turning Mermaid diagrams into clear,
shareable animations. The repository currently provides the application foundation, a
product-oriented home page, and an `/editor` placeholder for the upcoming editing
workspace.

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
