# Security Policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue, pull
request, or discussion for a suspected vulnerability.

- Preferred: open a private report through GitHub Security Advisories at
  <https://github.com/Orbasker/Animation-mermaid/security/advisories/new>.

Include as much as you can: affected version or commit, a description of the
issue, reproduction steps, and the impact you expect. We aim to acknowledge a
report within a few business days and will keep you updated as we investigate.

Please give us a reasonable window to release a fix before any public
disclosure.

## Supported versions

This project is under active development. Security fixes target the `main`
branch and the latest deployment.

## Dependencies and supply chain

Dependencies update through grouped weekly Dependabot pull requests, and every
PR is gated by CI vulnerability, provenance, and license checks. Production
builds emit a CycloneDX SBOM. For the emergency-patch, rollback, and
documented-exception procedures, see
[`docs/runbooks/dependency-security.md`](docs/runbooks/dependency-security.md).

## Handling secrets

- Never commit real credentials. Copy `.env.example` to `.env.local`
  (git-ignored) for local development.
- CI runs a secret scan (gitleaks) on every push and pull request and will fail
  the build if a credential is detected. The scan includes a self-test that
  proves it rejects a planted credential fixture.
- If you believe a secret was committed, rotate it immediately and report it as
  described above.
