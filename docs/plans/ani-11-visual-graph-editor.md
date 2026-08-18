# ANI-11 Visual Graph Editor

## Intent

Build an `/editor` workspace where imported Mermaid architecture entities can be selected, moved, grouped, hidden, annotated, and focused without mutating their source or semantic IDs.

## Constraints

- Persist canonical project documents through the existing IndexedDB repository.
- Keep visual edits renderer-neutral and keyed by `EntityId`.
- Preserve manual layout and applicable visual metadata across reimport.
- Make every graph mutation available from the keyboard and announced to assistive technology.
- Render the 200-node stress fixture without introducing an unbounded layout loop.

## Acceptance criteria

- The imported fixture is editable without changing Mermaid source.
- Manual positions survive reload and reimport.
- Undo and redo cover position, visibility, grouping, and annotation mutations.
- Keyboard users can select and modify components.
- The editor exposes source, story, compare, layer, and inspector surfaces.
- The 200-node stress fixture remains interactive.

## Differences from agreement

- None.

## Open Decisions

- None.

## Phase 1 — Renderer-neutral edit state

Objective: add persisted visual metadata and pure document transactions for all graph edits.

Files:

- `src/domain/graph.ts`
- `src/domain/editor.ts`
- `src/domain/editor.test.ts`
- `src/domain/index.ts`

Checks:

- Focused editor domain tests
- Existing graph and serialization tests

Exit criteria:

- Visual metadata is keyed by semantic IDs and validates references.
- Reimport preserves positions and compatible visual edits while leaving source unchanged.
- Undo/redo restores complete mutation states.
- A deterministic 200-node fixture is available.

Test seams:

- `applyEditorTransaction`
- `reconcileImportedSnapshot`
- `createStressSnapshot`

## Phase 2 — Interactive editor and autosave

Objective: replace the placeholder with a focused Client Component that renders and edits the graph, then autosaves document transactions through `ProjectRepository`.

Files:

- `src/app/editor/page.tsx`
- `src/app/editor/editor-workspace.tsx`
- `src/app/editor/editor-workspace.test.tsx`
- `src/app/routes.test.tsx`

Checks:

- Focused interaction tests for selection, keyboard movement, hide, annotate, grouping, undo, and redo
- Repository-backed reload integration test

Exit criteria:

- Pointer and keyboard users can perform the named graph actions.
- Source, story, compare, layer, and inspector surfaces are present.
- Autosave reports saving/saved/error states and persisted edits restore on mount.

Test seams:

- `EditorWorkspace`
- `ProjectRepository`

## Phase 3 — Responsive visual system and integration proof

Objective: provide a usable dense workspace across desktop and narrow viewports, then prove all acceptance scenarios.

Files:

- `src/app/globals.css`
- `src/app/editor/editor-workspace.tsx`
- `src/app/editor/editor-workspace.test.tsx`

Checks:

- Full unit and interaction suite
- ESLint
- TypeScript
- Production build

Exit criteria:

- Controls have visible focus, accessible names, and 44px touch targets where appropriate.
- Canvas supports pan/zoom and bounded rendering for 200 nodes.
- No horizontal page overflow on narrow screens; workspace panels remain reachable.
- Full verification suite passes.

Test seams:

- `EditorWorkspace`
- Next.js production build
