import {
  CURRENT_SCHEMA_VERSION,
  type Versioned,
} from "@/domain/schema-version";

/**
 * Stable semantic identifier for a graph entity. An id is assigned once, when an entity is
 * first imported, and is never reused. Every downstream layer — stories, the
 * agent context — refers to entities by this id, so identity survives re-imports and
 * re-layouts. IDs are semantic; they carry no positional meaning.
 */
export type EntityId = string & { readonly __brand: "EntityId" };

/** Identifier for a point-in-time snapshot of the graph. */
export type SnapshotId = string & { readonly __brand: "SnapshotId" };

export function entityId(value: string): EntityId {
  return value as EntityId;
}

export function snapshotId(value: string): SnapshotId {
  return value as SnapshotId;
}

/** The kinds of entity a graph is made of. */
export type EntityKind = "node" | "edge" | "group";

/** A node/vertex — the semantic identity of a box in the diagram. */
export interface NodeEntity {
  readonly kind: "node";
  readonly id: EntityId;
  /** Rendered text of the node, as authored in the source. */
  readonly label: string;
  /** Optional group (Mermaid `subgraph`) this node belongs to. */
  readonly groupId?: EntityId;
  /** Semantic, renderer-neutral attributes carried from the source (e.g. shape, class). */
  readonly attributes?: Readonly<Record<string, string>>;
}

/** A directed relationship between two entities. */
export interface EdgeEntity {
  readonly kind: "edge";
  readonly id: EntityId;
  readonly source: EntityId;
  readonly target: EntityId;
  /** Optional label rendered on the edge. */
  readonly label?: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

/** A named grouping of entities (Mermaid `subgraph`). */
export interface GroupEntity {
  readonly kind: "group";
  readonly id: EntityId;
  readonly label: string;
  readonly memberIds: readonly EntityId[];
}

/**
 * A graph entity is any semantically-identified element of the diagram. The discriminated
 * union is keyed by `kind` so new entity kinds can be added with exhaustive checking.
 * Entities hold *identity and meaning only* — never renderer coordinates. Positions live
 * in {@link LayoutHint}, keyed by entity id, so the same semantic graph can be laid out by
 * different renderers without changing identity.
 */
export type GraphEntity = NodeEntity | EdgeEntity | GroupEntity;

/**
 * Renderer-neutral positioning hint for a single entity. These are plain numbers, not a
 * React Flow / SVG / d3 object: a renderer consumes them, but the domain never depends on
 * one. Coordinates are optional and always separate from the entity's semantic identity.
 */
export interface LayoutHint {
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
}

export interface VisualGroup {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly EntityId[];
}

export interface GraphAnnotation {
  readonly id: string;
  readonly text: string;
  readonly entityId?: EntityId;
}

export interface GraphViewState {
  readonly hiddenEntityIds: readonly EntityId[];
  readonly groups: readonly VisualGroup[];
  readonly annotations: readonly GraphAnnotation[];
}

/** Metadata describing how a snapshot's source was imported. */
export interface ImporterMetadata {
  /** Identifier of the importer that produced the snapshot, e.g. "mermaid-flowchart". */
  readonly importer: string;
  /** Version of that importer, for reproducibility across importer changes. */
  readonly importerVersion: string;
  /** ISO-8601 timestamp of when the import ran, supplied by the caller. */
  readonly importedAt: string;
}

/**
 * The original diagram source and its provenance, preserved verbatim so a snapshot can
 * always be traced back to — and re-derived from — what the user actually authored.
 */
export interface MermaidSource {
  /** The diagram kind, e.g. "flowchart", "sequenceDiagram". */
  readonly diagramType: string;
  /** The raw Mermaid source, byte-for-byte as authored. */
  readonly text: string;
  readonly importer: ImporterMetadata;
}

/**
 * A versioned, point-in-time snapshot of a normalized diagram: its preserved source, the
 * semantic entities it contains, and optional renderer-neutral layout hints. This is the
 * source of truth for *what* exists; timing and emphasis live in {@link Story}.
 */
export interface GraphSnapshot extends Versioned {
  readonly id: SnapshotId;
  readonly source: MermaidSource;
  readonly entities: readonly GraphEntity[];
  /** Optional positions, kept strictly separate from entity identity. */
  readonly layout?: readonly LayoutHint[];
  /** User-authored presentation metadata, keyed by semantic entity ids. */
  readonly view?: GraphViewState;
}

export interface CreateGraphSnapshotInput {
  readonly id: SnapshotId;
  readonly source: MermaidSource;
  readonly entities?: readonly GraphEntity[];
  readonly layout?: readonly LayoutHint[];
  readonly view?: GraphViewState;
}

/** Builds a {@link GraphSnapshot} at the current schema version. */
export function createGraphSnapshot(
  input: CreateGraphSnapshotInput,
): GraphSnapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id,
    source: input.source,
    entities: input.entities ?? [],
    ...(input.layout !== undefined ? { layout: input.layout } : {}),
    ...(input.view !== undefined ? { view: input.view } : {}),
  };
}

export type GraphValidationCode =
  | "duplicate-entity-id"
  | "edge-missing-endpoint"
  | "group-missing-member"
  | "node-orphan-group"
  | "node-group-kind-mismatch"
  | "layout-missing-entity"
  | "non-finite-layout"
  | "visibility-missing-entity"
  | "visual-group-missing-member"
  | "annotation-missing-entity";

export interface GraphValidationError {
  readonly code: GraphValidationCode;
  readonly message: string;
  /** The entity the problem is anchored to, when applicable. */
  readonly entityId?: EntityId;
}

/**
 * Checks the referential integrity of a snapshot: unique entity ids, edges pointing at
 * existing entities, group membership pointing at existing entities, nodes referencing
 * existing groups, and layout hints referencing existing entities with finite coordinates.
 * Returns every problem found rather than throwing.
 */
export function validateGraphSnapshot(
  snapshot: GraphSnapshot,
): readonly GraphValidationError[] {
  const errors: GraphValidationError[] = [];

  const ids = new Set<EntityId>();
  const entitiesById = new Map<EntityId, GraphEntity>();
  for (const entity of snapshot.entities) {
    if (ids.has(entity.id)) {
      errors.push({
        code: "duplicate-entity-id",
        entityId: entity.id,
        message: `Duplicate entity id "${entity.id}".`,
      });
    }
    ids.add(entity.id);
    entitiesById.set(entity.id, entity);
  }

  for (const entity of snapshot.entities) {
    switch (entity.kind) {
      case "edge": {
        for (const [role, endpoint] of [
          ["source", entity.source],
          ["target", entity.target],
        ] as const) {
          if (!ids.has(endpoint)) {
            errors.push({
              code: "edge-missing-endpoint",
              entityId: entity.id,
              message: `Edge "${entity.id}" ${role} references unknown entity "${endpoint}".`,
            });
          }
        }
        break;
      }
      case "group": {
        for (const memberId of entity.memberIds) {
          if (!ids.has(memberId)) {
            errors.push({
              code: "group-missing-member",
              entityId: entity.id,
              message: `Group "${entity.id}" references unknown member "${memberId}".`,
            });
          }
        }
        break;
      }
      case "node": {
        if (entity.groupId !== undefined) {
          const group = entitiesById.get(entity.groupId);
          if (!group) {
            errors.push({
              code: "node-orphan-group",
              entityId: entity.id,
              message: `Node "${entity.id}" references unknown group "${entity.groupId}".`,
            });
          } else if (group.kind !== "group") {
            errors.push({
              code: "node-group-kind-mismatch",
              entityId: entity.id,
              message: `Node "${entity.id}" groupId "${entity.groupId}" resolves to ${group.kind}, not a group.`,
            });
          }
        }
        break;
      }
    }
  }

  for (const hint of snapshot.layout ?? []) {
    if (!ids.has(hint.entityId)) {
      errors.push({
        code: "layout-missing-entity",
        entityId: hint.entityId,
        message: `Layout hint references unknown entity "${hint.entityId}".`,
      });
    }
    for (const field of ["x", "y", "width", "height"] as const) {
      const value = hint[field];
      if (value !== undefined && !Number.isFinite(value)) {
        errors.push({
          code: "non-finite-layout",
          entityId: hint.entityId,
          message: `Layout hint "${hint.entityId}" ${field} must be finite.`,
        });
      }
    }
  }

  for (const hiddenId of snapshot.view?.hiddenEntityIds ?? []) {
    if (!ids.has(hiddenId)) {
      errors.push({
        code: "visibility-missing-entity",
        entityId: hiddenId,
        message: `Visibility state references unknown entity "${hiddenId}".`,
      });
    }
  }

  for (const group of snapshot.view?.groups ?? []) {
    for (const memberId of group.memberIds) {
      if (!ids.has(memberId)) {
        errors.push({
          code: "visual-group-missing-member",
          entityId: memberId,
          message: `Visual group "${group.id}" references unknown member "${memberId}".`,
        });
      }
    }
  }

  for (const annotation of snapshot.view?.annotations ?? []) {
    if (annotation.entityId !== undefined && !ids.has(annotation.entityId)) {
      errors.push({
        code: "annotation-missing-entity",
        entityId: annotation.entityId,
        message: `Annotation "${annotation.id}" references unknown entity "${annotation.entityId}".`,
      });
    }
  }

  return errors;
}
