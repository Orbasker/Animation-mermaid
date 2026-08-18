import type { ImportDiagnostic } from "@/domain/import/contract";
import type { EdgeArrow, EdgeLineStyle } from "@/domain/mermaid/types";

/**
 * The role a participant plays. `"participant"` renders as a box, `"actor"` as a stick figure
 * in Mermaid; the distinction is carried as a renderer-neutral attribute so a renderer can
 * reproduce it without re-reading the source. `"participant"` is the default and is never
 * emitted as an attribute.
 */
export type ParticipantRole = "participant" | "actor";

/** A participant discovered in the source, keyed by its source id (the semantic key). */
export interface ParsedParticipant {
  readonly id: string;
  readonly label: string;
  readonly role: ParticipantRole;
}

/**
 * A single directed message between two participants, in source order. Order is significant —
 * it is the spine of a sequence diagram — and is preserved by the order of this array.
 */
export interface ParsedMessage {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly line: EdgeLineStyle;
  readonly arrow: EdgeArrow;
}

/** The structural result of parsing a sequence diagram, plus every diagnostic gathered. */
export interface ParsedSequence {
  readonly participants: readonly ParsedParticipant[];
  readonly messages: readonly ParsedMessage[];
  readonly diagnostics: readonly ImportDiagnostic[];
  /** Set when a fatal diagnostic (bad header / empty source) prevented parsing. */
  readonly fatal: boolean;
}
