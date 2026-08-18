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

/** Renderer-neutral transform values used by story effects. */
export interface StoryTransform {
  readonly translateX: number;
  readonly translateY: number;
  readonly scale: number;
  readonly rotateDeg: number;
}

export type ComparisonChange = "added" | "removed" | "modified";

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
  | { readonly type: "focus"; readonly target: EntityId }
  | { readonly type: "trace"; readonly target: EntityId }
  | {
      readonly type: "transform";
      readonly target: EntityId;
      readonly to: StoryTransform;
    }
  | {
      readonly type: "compare";
      readonly target: EntityId;
      readonly change: ComparisonChange;
    }
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
  "focus",
  "trace",
  "transform",
  "compare",
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
  | "non-finite-duration"
  | "negative-duration"
  | "zero-duration"
  | "unsafe-duration"
  | "non-finite-story-duration"
  | "unsafe-story-duration"
  | "non-finite-transform"
  | "conflicting-scene-action"
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
    case "focus":
    case "trace":
    case "transform":
    case "compare":
    case "highlight":
    case "annotate":
      return [action.target];
    case "camera":
      return action.focus;
  }
}

function isFiniteStoryTransform(value: unknown): value is StoryTransform {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const transform = value as Partial<Record<keyof StoryTransform, unknown>>;
  return (
    Number.isFinite(transform.translateX) &&
    Number.isFinite(transform.translateY) &&
    Number.isFinite(transform.scale) &&
    Number.isFinite(transform.rotateDeg)
  );
}

type ActionChannel =
  | "visibility"
  | "focus"
  | "trace"
  | "transform"
  | "compare"
  | "highlight"
  | "annotation"
  | "camera";

function actionChannel(action: Action): ActionChannel {
  switch (action.type) {
    case "reveal":
    case "hide":
      return "visibility";
    case "focus":
      return "focus";
    case "trace":
      return "trace";
    case "transform":
      return "transform";
    case "compare":
      return "compare";
    case "highlight":
      return "highlight";
    case "annotate":
      return "annotation";
    case "camera":
      return "camera";
  }
}

function actionConflictKey(action: Action): string {
  const channel = actionChannel(action);
  return action.type === "camera" ? channel : `${channel}:${action.target}`;
}

/**
 * Validates a story against the snapshot it animates: the story must target that snapshot,
 * scene ids must be unique, durations and their aggregate must be finite and positive,
 * transforms must be finite, action channels cannot conflict, and every referenced entity
 * must exist in the snapshot. Returns all problems found rather than throwing.
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
  let totalDurationMs = 0;
  let aggregateDurationIsFinite = true;
  let sceneDurationsAreSafe = true;

  for (const scene of story.scenes) {
    if (sceneIds.has(scene.id)) {
      errors.push({
        code: "duplicate-scene-id",
        sceneId: scene.id,
        message: `Duplicate scene id "${scene.id}".`,
      });
    }
    sceneIds.add(scene.id);

    if (!Number.isFinite(scene.durationMs)) {
      errors.push({
        code: "non-finite-duration",
        sceneId: scene.id,
        message: `Scene "${scene.id}" has a non-finite duration.`,
      });
    } else if (scene.durationMs < 0) {
      errors.push({
        code: "negative-duration",
        sceneId: scene.id,
        message: `Scene "${scene.id}" has negative duration ${scene.durationMs}.`,
      });
    } else if (scene.durationMs === 0) {
      errors.push({
        code: "zero-duration",
        sceneId: scene.id,
        message: `Scene "${scene.id}" has zero duration; scene durations must be positive.`,
      });
    } else if (!Number.isSafeInteger(scene.durationMs)) {
      sceneDurationsAreSafe = false;
      errors.push({
        code: "unsafe-duration",
        sceneId: scene.id,
        message: `Scene "${scene.id}" duration must be a positive safe integer.`,
      });
    }
    if (Number.isFinite(scene.durationMs) && scene.durationMs > 0) {
      totalDurationMs += scene.durationMs;
      aggregateDurationIsFinite &&= Number.isFinite(totalDurationMs);
    }

    const seenActionChannels = new Set<string>();
    for (const action of scene.actions) {
      if (action.type === "transform" && !isFiniteStoryTransform(action.to)) {
        errors.push({
          code: "non-finite-transform",
          sceneId: scene.id,
          message: `Scene "${scene.id}" transform for "${action.target}" has a non-finite transform value.`,
        });
      }

      const conflictKey = actionConflictKey(action);
      if (seenActionChannels.has(conflictKey)) {
        const target = action.type === "camera" ? "camera" : action.target;
        errors.push({
          code: "conflicting-scene-action",
          sceneId: scene.id,
          message: `Scene "${scene.id}" has conflicting ${actionChannel(action)} actions for "${target}".`,
        });
      }
      seenActionChannels.add(conflictKey);

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

  if (!aggregateDurationIsFinite) {
    errors.push({
      code: "non-finite-story-duration",
      message: `Story "${story.id}" aggregate duration must be finite.`,
    });
  } else if (sceneDurationsAreSafe && !Number.isSafeInteger(totalDurationMs)) {
    errors.push({
      code: "unsafe-story-duration",
      message: `Story "${story.id}" aggregate duration exceeds the safe-integer timeline.`,
    });
  }

  return errors;
}

/** Total playback duration of a story, in milliseconds — the sum of its scenes. */
export function storyDurationMs(story: Story): number {
  const durationMs = story.scenes.reduce(
    (total, scene) => total + scene.durationMs,
    0,
  );
  if (!Number.isSafeInteger(durationMs)) {
    throw new RangeError(
      `Story "${story.id}" aggregate duration must fit the safe-integer timeline.`,
    );
  }
  return durationMs;
}
