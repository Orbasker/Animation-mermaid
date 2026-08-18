import type { EntityId, GraphSnapshot, SnapshotId } from "@/domain/graph";
import type { ProjectDocument } from "@/domain/project-document";
import {
  storyDurationMs,
  validateStory,
  type Action,
  type Scene,
  type Story,
  type StoryId,
  type StoryValidationError,
} from "@/domain/story";

/**
 * How applying a proposed story would change the local project.
 *
 * - `add` — a new story is appended.
 * - `noop` — a story with the same content-addressed id is already present, so applying
 *   changes nothing. Because proposals are content-addressed, re-applying the same approved
 *   run is idempotent rather than a duplicate.
 */
export type StoryApplicationMode = "add" | "noop";

/** A per-scene summary of what a proposed story would animate, for the review diff. */
export interface SceneApplication {
  readonly title: string;
  readonly durationMs: number;
  readonly actionCount: number;
  /** Distinct entity ids the scene's actions touch, in first-seen order. */
  readonly targets: readonly EntityId[];
}

/**
 * The plan for applying one proposed {@link Story} to a {@link ProjectDocument}: what would
 * change, and whether it can be applied cleanly. It is a pure function of the project and the
 * story, so a UI can render the diff and gate the Apply button on the same value the apply
 * path enforces.
 */
export interface StoryApplicationPlan {
  readonly story: Story;
  readonly snapshotId: SnapshotId;
  /** Whether the story's target snapshot exists in the project. */
  readonly snapshotFound: boolean;
  readonly mode: StoryApplicationMode;
  /** Ids of stories already in the project that animate the same snapshot. */
  readonly siblingStoryIds: readonly StoryId[];
  readonly scenes: readonly SceneApplication[];
  readonly totalDurationMs: number;
  /** Validation problems that make the story inapplicable; empty when applicable. */
  readonly errors: readonly StoryValidationError[];
  readonly applicable: boolean;
}

/** Thrown by {@link applyStoryProposal} when a story cannot be applied to the project. */
export class StoryNotApplicableError extends Error {
  readonly errors: readonly StoryValidationError[];

  constructor(message: string, errors: readonly StoryValidationError[]) {
    super(message);
    this.name = "StoryNotApplicableError";
    this.errors = errors;
  }
}

function actionTargets(action: Action): readonly EntityId[] {
  return action.type === "camera" ? action.focus : [action.target];
}

function sceneApplication(scene: Scene): SceneApplication {
  const targets: EntityId[] = [];
  const seen = new Set<EntityId>();
  for (const action of scene.actions) {
    for (const target of actionTargets(action)) {
      if (!seen.has(target)) {
        seen.add(target);
        targets.push(target);
      }
    }
  }
  return {
    title: scene.title,
    durationMs: scene.durationMs,
    actionCount: scene.actions.length,
    targets,
  };
}

function findSnapshot(
  project: ProjectDocument,
  id: SnapshotId,
): GraphSnapshot | undefined {
  return project.snapshots.find((snapshot) => snapshot.id === id);
}

/**
 * Computes how applying a proposed story would affect the project without mutating it.
 *
 * The story is validated against the snapshot it targets with the project's own
 * {@link validateStory} — the same rules {@link import("@/domain").validateProjectDocument}
 * enforces — so a plan that reports `applicable` is one whose apply will keep the project
 * valid. A missing target snapshot is itself an inapplicability, reported without throwing.
 */
export function planStoryApplication(
  project: ProjectDocument,
  story: Story,
): StoryApplicationPlan {
  const snapshot = findSnapshot(project, story.snapshotId);
  const scenes = story.scenes.map(sceneApplication);
  const siblingStoryIds = project.stories
    .filter((existing) => existing.snapshotId === story.snapshotId)
    .map((existing) => existing.id);
  const alreadyPresent = project.stories.some((existing) => existing.id === story.id);

  const errors: StoryValidationError[] = snapshot
    ? [...validateStory(story, snapshot)]
    : [
        {
          code: "story-snapshot-mismatch",
          message: `The project has no snapshot "${story.snapshotId}" for this story to animate.`,
        },
      ];

  return {
    story,
    snapshotId: story.snapshotId,
    snapshotFound: snapshot !== undefined,
    mode: alreadyPresent ? "noop" : "add",
    siblingStoryIds,
    scenes,
    totalDurationMs: scenes.reduce((total, scene) => total + scene.durationMs, 0),
    errors,
    applicable: errors.length === 0,
  };
}

/**
 * Returns a copy of the project with the proposed story applied, or throws
 * {@link StoryNotApplicableError} if the plan is not applicable.
 *
 * Applying is a pure, single transformation over the document: the caller pairs the returned
 * project with the one it passed in to get an undo/redo transaction whose reverse is
 * byte-for-byte the original. A story already present (same content-addressed id) returns the
 * project unchanged, so applying the same approved proposal twice is a no-op rather than a
 * duplicate.
 */
export function applyStoryProposal(
  project: ProjectDocument,
  story: Story,
): ProjectDocument {
  const plan = planStoryApplication(project, story);
  if (!plan.applicable) {
    throw new StoryNotApplicableError(
      `Story "${story.id}" cannot be applied: ${
        plan.errors[0]?.message ?? "unknown reason"
      }`,
      plan.errors,
    );
  }
  if (plan.mode === "noop") {
    return project;
  }
  // Referencing storyDurationMs keeps the safe-integer timeline guarantee on the apply path,
  // not only in the plan's summed preview.
  storyDurationMs(story);
  return { ...project, stories: [...project.stories, story] };
}
