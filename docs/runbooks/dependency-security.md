# Dependency & supply-chain security

How dependencies are updated, what CI enforces, how to patch an emergency
vulnerability, how to roll a bad update back, and how to record an exception
when a critical advisory has no fix yet.

## What runs, and where

Every check below runs on each pull request unless noted. Dependabot PRs run the
full `CI` and `Security` suites like any other PR, so a dependency bump is held
to the same gate as application code.

- **Grouped update PRs** — `.github/dependabot.yml` opens weekly PRs (runtime and
  dev-tooling separated) with a release cooldown.
- **Vulnerability audit** — `Security` → `dependency-audit` runs
  `pnpm audit --prod --audit-level high`; blocks merge.
- **Dependency review** — `Security` → `dependency-review` fails the PR diff on
  `high`; blocks merge.
- **Provenance** — `Security` → `provenance` runs `npm audit signatures` to
  verify registry signatures and provenance attestations; blocks merge.
- **License policy** — `Security` → `license-check` runs `pnpm license:check`;
  blocks merge.
- **SBOM** — `CI` → `build` emits the CycloneDX `sbom-cyclonedx` artifact
  (90-day retention) for the production closure.
- **Monthly review** — `.github/workflows/dependency-maintenance.yml` opens a
  tracking issue on the 1st of each month.

## Routine updates

Dependabot opens grouped PRs every Monday: one for runtime minor/patch, one for
dev-tooling minor/patch, and individual PRs for majors. A freshly published
version waits out a short **cooldown** before a PR opens — the cheapest defense
against a compromised release, which is usually yanked within days. Security
advisories bypass the cooldown.

Merge a grouped PR once its checks are green. For a major, read the changelog and
run the app (see [production-smoke-and-rollback.md](production-smoke-and-rollback.md))
before merging.

## Emergency patch (known vulnerability)

1. Confirm the advisory and the fixed version (GitHub alert, `pnpm audit --prod`).
2. Patch to the fixed version and refresh the lockfile:
   ```bash
   pnpm update <pkg>            # or: pnpm add <pkg>@<fixed-version>
   pnpm audit --prod --audit-level high   # must be clean
   ```
   For a transitive dependency with no direct upgrade path, force it with a
   pinned override in `pnpm-workspace.yaml` under `overrides:`, then re-run the
   audit.
3. `pnpm install` to reconcile, run `pnpm test` and `pnpm build` locally.
4. Open a PR titled with the advisory id. Let the full required suite gate it —
   do **not** bypass branch protection. If it must ship faster than review
   allows, get a second maintainer to approve; the checks still run.

## Documented exception (critical advisory with no fix)

Prefer fixing. Only when a high/critical advisory has **no non-breaking fix
reachable from our lockfile** do we accept it, and always with a paper trail:

- **pnpm audit gate** — add the GHSA id to `auditConfig.ignoreGhsas` in
  `pnpm-workspace.yaml`, with an inline comment naming the package, the path
  that pulls it in, and why there is no fix yet. This is the single source of
  truth for accepted audit exceptions; the `high` gate still fails on any *new*
  advisory.
- **Dependency-review gate** — for a PR-diff exception, add the id to
  `allow-ghsas` on the `dependency-review` step in `.github/workflows/security.yml`.

Every exception is temporary. Dependabot tracks the upstream fix; remove the id
the moment a patched version is reachable. The monthly review (below) re-checks
each entry.

If the `provenance` job fails, distinguish the cause: an **invalid** signature
means tampering — do not merge, and report it privately (see `SECURITY.md`). A
**missing** signature is almost always a legacy transitive package the registry
never signed; verify the package is expected, then prefer replacing or pinning
it over accepting an unverifiable artifact.

## Rollback (a merged update broke something)

Dependency updates are code changes, so they roll back the same way:

- **Before promotion** — the bad update is caught by CI or preview smoke; close
  or revert the PR.
- **After promotion** — roll the deployment back first (alias swap, seconds; see
  [production-smoke-and-rollback.md](production-smoke-and-rollback.md) §4), then
  `git revert` the update commit and open a fix-forward PR. Reverting restores
  the previous `package.json` **and** `pnpm-lock.yaml`, so the exact prior
  closure is reinstalled.

## Monthly maintenance routine

`dependency-maintenance.yml` runs on the 1st of each month (and on demand via
_Run workflow_). It audits every severity, checks licenses, regenerates the
SBOM, and opens a tracking issue. Work the issue's checklist:

- Triage and merge the safe grouped Dependabot PRs.
- Review the audit output; fix what has a fix, and re-justify or remove each
  `auditConfig.ignoreGhsas` exception.
- Confirm the SBOM artifact generated.

## SBOM

Every production build emits a CycloneDX 1.5 SBOM of the production dependency
closure as the `sbom-cyclonedx` artifact (`pnpm sbom` locally). It is
deterministic — an unchanged closure produces a byte-identical document — so
successive builds diff cleanly and the artifact answers "what shipped."
