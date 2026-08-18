# ADR 0001: Separate visual edits from the semantic graph

## Status

Accepted

## Context

Imported Mermaid diagrams need to remain portable and reimportable while users arrange,
group, hide, and annotate their components. Rewriting source text for presentation-only
changes would couple canvas behavior to Mermaid formatting and make stable reimport
reconciliation difficult.

## Decision

Store manual positions and visual metadata on each graph snapshot, keyed by semantic
entity ID. Editor transactions update this renderer-neutral view state and never mutate
the imported source or semantic entities. Reimport builds a fresh semantic snapshot, then
retains visual data only for entity IDs that still exist.

## Consequences

- Mermaid source remains unchanged by visual editing and can be exported or reimported.
- Positions, visibility, groups, and annotations survive reload and compatible reimports.
- Importers must produce stable entity IDs for visual continuity.
- Visual groups are presentation metadata rather than new semantic graph entities.
