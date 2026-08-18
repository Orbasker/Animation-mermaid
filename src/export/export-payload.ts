import type {
  EntityId,
  GraphEntity,
  GraphSnapshot,
  LayoutHint,
} from "@/domain/graph";
import type { Action, Scene, Story, StoryId } from "@/domain/story";
import { validateStory } from "@/domain/story";
import type { ProjectDocument } from "@/domain/project-document";
import { renderStoryAt } from "@/domain/story-engine";

/**
 * Version of the export format itself, independent of the domain schema version. The player
 * runtime embedded in an exported file reads payloads at this version; bump it only when the
 * embedded shape changes in a way the runtime must branch on.
 */
export const EXPORT_FORMAT_VERSION = "1.0.0";

/** Thrown when a project/story cannot be turned into a safe, self-contained export. */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/**
 * A graph entity reduced to exactly what an offline player needs to draw and animate it:
 * identity, kind, label, and structural links. Deliberately drops semantic `attributes`
 * (the player never renders them) and the schema version, keeping the payload minimal.
 */
export type ExportEntity =
  | {
      readonly kind: "node";
      readonly id: EntityId;
      readonly label: string;
      readonly groupId?: EntityId;
    }
  | {
      readonly kind: "edge";
      readonly id: EntityId;
      readonly source: EntityId;
      readonly target: EntityId;
      readonly label?: string;
    }
  | {
      readonly kind: "group";
      readonly id: EntityId;
      readonly label: string;
      readonly memberIds: readonly EntityId[];
    };

export interface ExportLayout {
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
}

export interface ExportSnapshot {
  readonly id: GraphSnapshot["id"];
  readonly entities: readonly ExportEntity[];
  readonly layout: readonly ExportLayout[];
}

export interface ExportStory {
  readonly id: StoryId;
  readonly title: string;
  readonly snapshotId: GraphSnapshot["id"];
  readonly scenes: readonly Scene[];
}

/**
 * Source attribution surfaced to reviewers: where the diagram came from and how it was
 * imported. Deliberately excludes anything private — no raw editor source text, no hosted
 * AI run identifiers, no repository/IndexedDB bookkeeping.
 */
export interface ExportMeta {
  readonly formatVersion: string;
  readonly projectName: string;
  readonly storyId: StoryId;
  readonly storyTitle: string;
  readonly diagramType: string;
  readonly importer: string;
  readonly importerVersion: string;
  readonly importedAt: string;
}

/** A static, per-scene summary used by the no-JS fallback and the accessible outline. */
export interface ExportOutlineScene {
  readonly title: string;
  readonly durationMs: number;
  readonly descriptions: readonly string[];
}

/**
 * The complete, sanitized artifact embedded in an exported HTML file. It carries only the
 * data required to play one story offline: the whitelisted snapshot it animates, the story's
 * scenes, source attribution, and a static outline. Everything else in a project — other
 * snapshots, other stories, comparisons, importer source text, and any repository or hosted
 * AI metadata — is left behind by construction.
 */
export interface ExportPayload {
  readonly meta: ExportMeta;
  readonly snapshot: ExportSnapshot;
  readonly story: ExportStory;
  readonly outline: readonly ExportOutlineScene[];
}

function sanitizeEntity(entity: GraphEntity): ExportEntity {
  switch (entity.kind) {
    case "node":
      return {
        kind: "node",
        id: entity.id,
        label: entity.label,
        ...(entity.groupId !== undefined ? { groupId: entity.groupId } : {}),
      };
    case "edge":
      return {
        kind: "edge",
        id: entity.id,
        source: entity.source,
        target: entity.target,
        ...(entity.label !== undefined ? { label: entity.label } : {}),
      };
    case "group":
      return {
        kind: "group",
        id: entity.id,
        label: entity.label,
        memberIds: [...entity.memberIds],
      };
  }
}

function sanitizeLayout(hint: LayoutHint): ExportLayout {
  return {
    entityId: hint.entityId,
    x: hint.x,
    y: hint.y,
    ...(hint.width !== undefined ? { width: hint.width } : {}),
    ...(hint.height !== undefined ? { height: hint.height } : {}),
  };
}

function sanitizeAction(action: Action): Action {
  return action;
}

function sanitizeScene(scene: Scene): Scene {
  return {
    id: scene.id,
    title: scene.title,
    durationMs: scene.durationMs,
    actions: scene.actions.map(sanitizeAction),
  };
}

/**
 * Builds the static outline the no-JS fallback renders and the runtime reads for its
 * accessible scene descriptions. Each scene is described by sampling the *real* story engine
 * at that scene's midpoint, so the outline text is produced by exactly one code path shared
 * with live playback.
 */
function buildOutline(
  snapshot: GraphSnapshot,
  story: Story,
): readonly ExportOutlineScene[] {
  let startedAtMs = 0;
  return story.scenes.map((scene) => {
    const midpointMs = startedAtMs + Math.floor(scene.durationMs / 2);
    startedAtMs += scene.durationMs;
    const state = renderStoryAt({ snapshot, story, timestampMs: midpointMs });
    return {
      title: scene.title,
      durationMs: scene.durationMs,
      descriptions: state.communication
        ? [...state.communication.descriptions]
        : [],
    };
  });
}

/**
 * Turns one story inside a project into a sanitized, self-contained {@link ExportPayload}.
 *
 * The story must exist in the project, target a snapshot that exists, and validate cleanly
 * against it — otherwise an {@link ExportError} is thrown before any payload is produced, so
 * a broken story never ships as a silently-empty export. The returned payload whitelists
 * fields explicitly: nothing from the wider project (other snapshots, stories, comparisons),
 * the importer's raw source text, or any repository/hosted-AI bookkeeping can leak into it.
 */
export function buildExportPayload(
  project: ProjectDocument,
  targetStoryId: StoryId,
): ExportPayload {
  const story = project.stories.find(
    (candidate) => candidate.id === targetStoryId,
  );
  if (!story) {
    throw new ExportError(`Project has no story with id "${targetStoryId}".`);
  }

  const snapshot = project.snapshots.find(
    (candidate) => candidate.id === story.snapshotId,
  );
  if (!snapshot) {
    throw new ExportError(
      `Story "${story.id}" targets unknown snapshot "${story.snapshotId}".`,
    );
  }

  if (story.scenes.length === 0) {
    throw new ExportError(`Story "${story.id}" has no scenes to export.`);
  }

  const validationErrors = validateStory(story, snapshot);
  if (validationErrors.length > 0) {
    throw new ExportError(
      `Cannot export invalid story "${story.id}": ${validationErrors
        .map((error) => error.message)
        .join(" ")}`,
    );
  }

  return {
    meta: {
      formatVersion: EXPORT_FORMAT_VERSION,
      projectName: project.name,
      storyId: story.id,
      storyTitle: story.title,
      diagramType: snapshot.source.diagramType,
      importer: snapshot.source.importer.importer,
      importerVersion: snapshot.source.importer.importerVersion,
      importedAt: snapshot.source.importer.importedAt,
    },
    snapshot: {
      id: snapshot.id,
      entities: snapshot.entities.map(sanitizeEntity),
      layout: (snapshot.layout ?? []).map(sanitizeLayout),
    },
    story: {
      id: story.id,
      title: story.title,
      snapshotId: story.snapshotId,
      scenes: story.scenes.map(sanitizeScene),
    },
    outline: buildOutline(snapshot, story),
  };
}
