# Contributing

Thanks for contributing to Animation Mermaid. This guide covers the local
workflow and the checks every change must pass.

## Prerequisites

- Node.js matching the version in [`.nvmrc`](.nvmrc) (the CI baseline). Any
  version allowed by the `engines` field in `package.json` works locally.
- pnpm 10 (pinned via `packageManager` in `package.json`). Enable it with
  Corepack if needed:

  ```bash
  corepack enable
  corepack prepare pnpm@10.30.0 --activate
  ```

## Local setup

```bash
pnpm install
pnpm dev
```

## The checks CI runs

Every pull request runs the exact commands you can run locally. Run them before
pushing:

```bash
pnpm install --frozen-lockfile   # lockfile must be committed and in sync
pnpm format:check                # Prettier
pnpm lint                        # ESLint (incl. import boundaries + naming)
pnpm typecheck                   # tsc --noEmit
pnpm test                        # unit + workflow integration tests
pnpm build                       # production Next.js build
```

Auto-fix formatting with `pnpm format`. The end-to-end journey (`pnpm test:e2e`)
also runs in CI; run it locally when you touch the editor or story flow.

Security checks that run in CI:

- **Secret scan** — gitleaks on the whole tree. Never commit real credentials.
- **Dependency review + audit** — new high-severity advisories block merge.
- **License policy** — `pnpm license:check` rejects strong/network copyleft.

## Branches and commits

- Work is tracked in Linear. Keep the issue id (for example `ANI-19`) in the
  branch name and the pull request title: `ANI-19: enforce CI quality gates`.
- Write focused commits with clear messages describing the change.

## Pull requests

- Fill in the PR template: scope (with the linked issue), the validation
  commands you ran, and screenshots for any user-visible change.
- Keep the committed lockfile (`pnpm-lock.yaml`) in sync with `package.json`.
- All required checks must be green and the branch up to date with `main`
  before merge. Direct pushes to `main` are not allowed.

## Adding dependencies

Use pnpm so the lockfile stays authoritative:

```bash
pnpm add <pkg>
pnpm add -D <pkg>
```

Check the license is compatible (`pnpm license:check`) and commit the updated
`pnpm-lock.yaml`.
