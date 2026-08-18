import type { EntityId } from "@/domain/graph";
import {
  actionChannel,
  actionConflictKey,
  actionTargets,
  sceneId as toSceneId,
  type Action,
  type ActionChannel,
  type Scene,
  type SceneId,
  type Story,
  type StoryValidationTarget,
} from "@/domain/story";

/**
 * Authoring operations over a {@link Story}'s scene timeline. Scenes are *references* over a
 * stable {@link import("@/domain/graph").GraphSnapshot} — every operation reorders, edits, or
 * annotates references and never touches, copies, or duplicates the graph entities themselves.
 * The union mirrors the editor's `EditorTransaction`: pure, serializable, and applied by a
 * single reducer so the timeline UI stays a thin dispatcher.
 */
export type TimelineOperation =
  | {
      readonly type: "add-scene";
      readonly id: SceneId;
      readonly title: string;
      readonly durationMs: number;
      /** Insert after this scene; appended to the end when omitted or not found. */
      readonly afterSceneId?: SceneId;
    }
  | {
      readonly type: "duplicate-scene";
      readonly sceneId: SceneId;
      /** Id for the copy, which is inserted directly after its source. */
      readonly id: SceneId;
    }
  | { readonly type: "remove-scene"; readonly sceneId: SceneId }
  | {
      readonly type: "rename-scene";
      readonly sceneId: SceneId;
      readonly title: string;
    }
  | {
      readonly type: "set-duration";
      readonly sceneId: SceneId;
      readonly durationMs: number;
    }
  | {
      readonly type: "move-scene";
      readonly sceneId: SceneId;
      readonly toIndex: number;
    }
  /** Upsert an action: any existing action on the same channel and target is replaced. */
  | {
      readonly type: "set-action";
      readonly sceneId: SceneId;
      readonly action: Action;
    }
  | {
      readonly type: "remove-action";
      readonly sceneId: SceneId;
      readonly channel: ActionChannel;
      /** Ignored for the single-slot `camera` channel. */
      readonly target?: EntityId;
    };

/**
 * Allocates a scene id that does not collide with any scene already in the story. Ids are
 * derived from a stable hint and a numeric suffix so repeated authoring stays deterministic.
 */
export function allocateSceneId(story: Story, hint = "scene"): SceneId {
  const existing = new Set<string>(story.scenes.map((scene) => scene.id));
  let index = story.scenes.length + 1;
  let candidate = `${hint}-${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${hint}-${index}`;
  }
  return toSceneId(candidate);
}

function mapScene(
  story: Story,
  sceneId: SceneId,
  change: (scene: Scene) => Scene,
): Story {
  let changed = false;
  const scenes = story.scenes.map((scene) => {
    if (scene.id !== sceneId) return scene;
    changed = true;
    return change(scene);
  });
  return changed ? { ...story, scenes } : story;
}

function upsertAction(
  actions: readonly Action[],
  action: Action,
): readonly Action[] {
  const key = actionConflictKey(action);
  return [
    ...actions.filter((existing) => actionConflictKey(existing) !== key),
    action,
  ];
}

function matchesChannelTarget(
  action: Action,
  channel: ActionChannel,
  target: EntityId | undefined,
): boolean {
  if (actionChannel(action) !== channel) return false;
  if (channel === "camera") return true;
  return action.type !== "camera" && action.target === target;
}

/** Applies a single timeline operation, returning a new story (the input is never mutated). */
export function applyTimelineOperation(
  story: Story,
  operation: TimelineOperation,
): Story {
  switch (operation.type) {
    case "add-scene": {
      const scene: Scene = {
        id: operation.id,
        title: operation.title,
        durationMs: operation.durationMs,
        actions: [],
      };
      const afterIndex = operation.afterSceneId
        ? story.scenes.findIndex((item) => item.id === operation.afterSceneId)
        : -1;
      const scenes =
        afterIndex >= 0
          ? [
              ...story.scenes.slice(0, afterIndex + 1),
              scene,
              ...story.scenes.slice(afterIndex + 1),
            ]
          : [...story.scenes, scene];
      return { ...story, scenes };
    }
    case "duplicate-scene": {
      const index = story.scenes.findIndex(
        (item) => item.id === operation.sceneId,
      );
      if (index < 0) return story;
      const source = story.scenes[index];
      const copy: Scene = {
        id: operation.id,
        title: `${source.title} copy`,
        durationMs: source.durationMs,
        actions: source.actions.map((action) => ({ ...action })),
      };
      const scenes = [
        ...story.scenes.slice(0, index + 1),
        copy,
        ...story.scenes.slice(index + 1),
      ];
      return { ...story, scenes };
    }
    case "remove-scene": {
      const scenes = story.scenes.filter(
        (item) => item.id !== operation.sceneId,
      );
      return scenes.length === story.scenes.length
        ? story
        : { ...story, scenes };
    }
    case "rename-scene":
      return mapScene(story, operation.sceneId, (scene) => ({
        ...scene,
        title: operation.title,
      }));
    case "set-duration":
      return mapScene(story, operation.sceneId, (scene) => ({
        ...scene,
        durationMs: operation.durationMs,
      }));
    case "move-scene": {
      const from = story.scenes.findIndex(
        (item) => item.id === operation.sceneId,
      );
      if (from < 0) return story;
      const to = Math.max(
        0,
        Math.min(story.scenes.length - 1, operation.toIndex),
      );
      if (to === from) return story;
      const scenes = [...story.scenes];
      const [moved] = scenes.splice(from, 1);
      scenes.splice(to, 0, moved);
      return { ...story, scenes };
    }
    case "set-action":
      return mapScene(story, operation.sceneId, (scene) => ({
        ...scene,
        actions: upsertAction(scene.actions, operation.action),
      }));
    case "remove-action":
      return mapScene(story, operation.sceneId, (scene) => ({
        ...scene,
        actions: scene.actions.filter(
          (action) =>
            !matchesChannelTarget(action, operation.channel, operation.target),
        ),
      }));
  }
}

/** A scene that references graph entities no longer present in the target snapshot. */
export interface SceneReferenceWarning {
  readonly sceneId: SceneId;
  readonly sceneTitle: string;
  /** The distinct missing entity ids the scene still references. */
  readonly missingEntityIds: readonly EntityId[];
  readonly message: string;
}

/**
 * Finds scenes whose actions reference entities absent from `snapshot`. This is the signal
 * behind a repairable warning: deleting or renaming a graph entity (which changes its stable
 * id) leaves the scenes that named it dangling, and each returned warning is resolved by
 * {@link repairSceneReferences}.
 */
export function collectSceneReferenceWarnings(
  story: Story,
  snapshot: StoryValidationTarget,
): readonly SceneReferenceWarning[] {
  const entityIds = new Set<EntityId>(
    snapshot.entities.map((entity) => entity.id),
  );
  const warnings: SceneReferenceWarning[] = [];

  for (const scene of story.scenes) {
    const missing = new Set<EntityId>();
    for (const action of scene.actions) {
      for (const target of actionTargets(action)) {
        if (!entityIds.has(target)) missing.add(target);
      }
    }
    if (missing.size > 0) {
      const missingEntityIds = [...missing];
      warnings.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        missingEntityIds,
        message: `Scene "${scene.title}" references ${missingEntityIds.length} missing ${
          missingEntityIds.length === 1 ? "entity" : "entities"
        }: ${missingEntityIds.join(", ")}.`,
      });
    }
  }

  return warnings;
}

/**
 * Prunes every dangling reference from a story so it validates against `snapshot` again:
 * entity-targeted actions pointing at a missing entity are dropped, and a `camera` frame keeps
 * only the entities that still exist (an emptied frame becomes "fit the whole diagram"). Scenes,
 * their order, and their durations are preserved — only broken references are removed.
 */
export function repairSceneReferences(
  story: Story,
  snapshot: StoryValidationTarget,
): Story {
  const entityIds = new Set<EntityId>(
    snapshot.entities.map((entity) => entity.id),
  );

  const scenes = story.scenes.map((scene) => {
    const actions = scene.actions.flatMap((action): Action[] => {
      if (action.type === "camera") {
        return [
          { ...action, focus: action.focus.filter((id) => entityIds.has(id)) },
        ];
      }
      return entityIds.has(action.target) ? [action] : [];
    });
    return { ...scene, actions };
  });

  return { ...story, scenes };
}
