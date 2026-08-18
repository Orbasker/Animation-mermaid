<!--
Keep the title in the form `ANI-<id>: <summary>` so the change stays linked to
its Linear issue. If there is no issue, say so under Scope.
-->

## Scope

<!-- What does this change do, and why? Link the Linear issue. -->

Closes ANI-<id>

## Validation

<!--
Paste the commands you ran locally and their result. Every PR must pass the
same checks CI runs:
-->

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`

## Screenshots / recordings

<!-- Required for any user-visible change; write "N/A" otherwise. -->

## Notes for reviewers

<!-- Risks, trade-offs, follow-ups, anything that needs a closer look. -->
