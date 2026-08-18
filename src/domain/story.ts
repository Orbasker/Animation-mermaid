import { CURRENT_SCHEMA_VERSION, type Versioned } from "@/domain/schema-version";
import type { EntityId, GraphSnapshot } from "@/domain/graph";

/** Identifiers for storyboard elements. */
export type StoryId = string & { readonly __brand: "StoryId" };
export type SceneId = string & { readonly __brand: "SceneId" };

export function storyId(value: string): StoryId {
  return value as StoryId;
}

export function sceneId(value: string): SceneId {
  return value as SceneId;
}

/**
 * A single animation instruction inside a scene. Actions are a discriminated union keyed
 * by `type` and refer to graph entities *only by id* — they carry no React Flow node,
 * Mermaid SVG element, or animation-library timeline object. The renderer resolves ids and
 * named styles at playback time. This is the boundary that keeps scene data portable and
 * serializable.
 */
export type Action =
  | { readonly type: "reveal"; readonly target: EntityId }
  | { readonly type: "hide"; readonly target: EntityId }
  | {
      readonly type: "highlight";
      readonly target: EntityId;
      /** Named emphasis style, resolved by the renderer. */
      readonly style?: string;
    }
  | {
      readonly type: "annotate";
      readonly target: EntityId;
      /** Caption text shown against the entity for the duration of the scene. */
      readonly text: string;
    }
  | {
      readonly type: "camera";
      /** Entities to frame; empty means fit the whole diagram. */
      readonly focus: readonly EntityId[];
    };

export const ACTION_TYPES = [
  "reveal",
  "hide",
  "highlight",
  "annotate",
  "camera",
] as const satisfies readonly Action["type"][];

/**
 * A scene is one beat of playback: a titled group of actions applied together over a fixed
 * duration. Scenes within a story play in array order, and the fixed duration is what makes
 * a story deterministically seekable.
 */
export interface Scene {
  readonly id: SceneId;
  readonly title: string;
  /** Playback duration of this scene, in milliseconds. */
  readonly durationMs: number;
  readonly actions: readonly Action[];
}

/**
 * The storyboard layered over a {@link GraphSnapshot}: a versioned, ordered list of scenes
 * describing *how* the diagram animates. It targets the snapshot with `snapshotId` and
 * references entities by id, so a story and the graph it animates version independently
 * inside a project.
 */
export interface Story extends Versioned {
  readonly id: StoryId;
  readonly title: string;
  /** The snapshot this story animates. */
  readonly snapshotId: GraphSnapshot["id"];
  readonly scenes: readonly Scene[];
}

export interface CreateStoryInput {
  readonly id: StoryId;
  readonly title: string;
  readonly snapshotId: GraphSnapshot["id"];
  readonly scenes?: readonly Scene[];
}

/** Builds a {@link Story} at the current schema version. */
export function createStory(input: CreateStoryInput): Story {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    snapshotId: input.snapshotId,
    scenes: input.scenes ?? [],
  };
}

export type StoryValidationCode =
  | "duplicate-scene-id"
  | "negative-duration"
  | "action-missing-entity"
  | "story-snapshot-mismatch";

export interface StoryValidationError {
  readonly code: StoryValidationCode;
  readonly message: string;
  readonly sceneId?: SceneId;
}

function actionTargets(action: Action): readonly EntityId[] {
  switch (action.type) {
    case "reveal":
    case "hide":
    case "highlight":
    case "annotate":
      return [action.target];
    case "camera":
      return action.focus;
  }
}

/**
 * Validates a story against the snapshot it animates: the story must target that snapshot,
 * scene ids must be unique, durations non-negative, and every entity an action references
 * must exist in the snapshot. Returns all problems found rather than throwing, each with an
 * actionable message.
 */
export function validateStory(
  story: Story,
  snapshot: GraphSnapshot,
): readonly StoryValidationError[] {
  const errors: StoryValidationError[] = [];

  if (story.snapshotId !== snapshot.id) {
    errors.push({
      code: "story-snapshot-mismatch",
      message: `Story "${story.id}" targets snapshot "${story.snapshotId}" but was validated against "${snapshot.id}".`,
    });
  }

  const entityIds = new Set<EntityId>(
    snapshot.entities.map((entity) => entity.id),
  );
  const sceneIds = new Set<SceneId>();

  for (const scene of story.scenes) {
    if (sceneIds.has(scene.id)) {
      errors.push({
        code: "duplicate-scene-id",
        sceneId: scene.id,
        message: `Duplicate scene id "${scene.id}".`,
      });
    }
    sceneIds.add(scene.id);

    if (scene.durationMs < 0) {
      errors.push({
        code: "negative-duration",
        sceneId: scene.id,
        message: `Scene "${scene.id}" has negative duration ${scene.durationMs}.`,
      });
    }

    for (const action of scene.actions) {
      for (const target of actionTargets(action)) {
        if (!entityIds.has(target)) {
          errors.push({
            code: "action-missing-entity",
            sceneId: scene.id,
            message: `Scene "${scene.id}" ${action.type} references unknown entity "${target}".`,
          });
        }
      }
    }
  }

  return errors;
}

/** Total playback duration of a story, in milliseconds — the sum of its scenes. */
export function storyDurationMs(story: Story): number {
  return story.scenes.reduce((total, scene) => total + scene.durationMs, 0);
}
