import type { ImportDiagnostic } from "@/domain/import/contract";

/**
 * The line style of a relation, carried as a renderer-neutral attribute. `"solid"` is the
 * default (`-->`, `--`) and is never emitted; `"dashed"` covers PlantUML's dotted connectors
 * (`..>`, `..`), used for dependencies and realizations.
 */
export type RelationLine = "solid" | "dashed";

/**
 * The UML meaning of a relation, classified from its connector so a renderer can draw the
 * right arrowhead without re-reading the source. `"association"` is the default (`-->`, `->`,
 * `--`) and is never emitted as an attribute.
 */
export type RelationKind =
  "association" | "dependency" | "extension" | "composition" | "aggregation";

/**
 * An element discovered in the source, keyed by its source id (the semantic key). `type` is the
 * declaring keyword (`class`, `component`, `actor`, …) when the element was declared explicitly;
 * elements first seen in a relation carry no type. `groupId` is the innermost container it sits in.
 */
export interface ParsedElement {
  readonly id: string;
  readonly label: string;
  readonly type?: string;
  readonly groupId?: string;
}

/** A directed relation between two source ids, in source order. */
export interface ParsedRelation {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly line: RelationLine;
  readonly kind: RelationKind;
}

/**
 * A container (`package`/`namespace`/`rectangle`/`node`/…) and its direct members — nodes and
 * nested containers — in mention order. Containers map to {@link GroupEntity}s so they feed the
 * drill-down explorer as nested drill-down groups.
 */
export interface ParsedContainer {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly string[];
}

/** The structural result of parsing a PlantUML diagram, plus every diagnostic gathered. */
export interface ParsedPlantuml {
  readonly elements: readonly ParsedElement[];
  readonly containers: readonly ParsedContainer[];
  readonly relations: readonly ParsedRelation[];
  readonly diagnostics: readonly ImportDiagnostic[];
  /** Set when a fatal diagnostic (missing `@startuml` / empty source) prevented parsing. */
  readonly fatal: boolean;
}
