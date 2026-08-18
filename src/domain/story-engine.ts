import type {
  EntityId,
  EntityKind,
  GraphValidationError,
  GraphEntity,
  GraphSnapshot,
} from "@/domain/graph";
import { validateGraphSnapshot } from "@/domain/graph";
import {
  storyDurationMs,
  validateStory,
  type Action,
  type ComparisonChange,
  type Scene,
  type Story,
  type StoryTransform,
  type StoryValidationError,
} from "@/domain/story";
import {
  decodeGraphSnapshot,
  decodeStory,
  DomainDecodeError,
} from "@/domain/runtime-decoder";

function identityTransform(): StoryTransform {
  return {
    translateX: 0,
    translateY: 0,
    scale: 1,
    rotateDeg: 0,
  };
}

export interface EntityRenderState {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly visible: boolean;
  readonly opacity: number;
  readonly focusProgress: number;
  readonly traceProgress: number;
  readonly transform: StoryTransform;
  readonly comparison?: ComparisonChange;
  readonly highlightStyle?: string;
  readonly annotation?: string;
}

export interface CameraRenderState {
  readonly from: readonly EntityId[];
  readonly to: readonly EntityId[];
  readonly progress: number;
}

export interface ActiveSceneRenderState {
  readonly id: Scene["id"];
  readonly title: string;
  readonly index: number;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly progress: number;
}

export type MotionMode = "full" | "reduced" | "static";

export interface PlaybackPreferences {
  readonly reducedMotion?: boolean;
  readonly staticFallback?: boolean;
}

export interface SceneCommunication {
  readonly sceneTitle: string;
  readonly descriptions: readonly string[];
}

export interface StoryRenderState {
  readonly timestampMs: number;
  readonly durationMs: number;
  readonly motionMode: MotionMode;
  readonly transitionProgress: number;
  readonly activeScene: ActiveSceneRenderState | null;
  readonly entities: readonly EntityRenderState[];
  readonly camera: CameraRenderState;
  readonly communication: SceneCommunication | null;
}

export interface RenderStoryAtInput {
  readonly snapshot: GraphSnapshot;
  readonly story: Story;
  readonly timestampMs: number;
  readonly preferences?: PlaybackPreferences;
}

export type RenderInputIssue =
  | ({ readonly scope: "snapshot" } & GraphValidationError)
  | ({ readonly scope: "story" } & StoryValidationError)
  | {
      readonly scope: "snapshot" | "story";
      readonly code: "invalid-structure";
      readonly message: string;
    };

export class StoryRenderInputError extends Error {
  readonly issues: readonly RenderInputIssue[];

  constructor(issues: readonly RenderInputIssue[]) {
    super(
      `Cannot render invalid input: ${issues.map((issue) => issue.message).join(" ")}`,
    );
    this.name = "StoryRenderInputError";
    this.issues = issues;
  }
}

interface MutableEntityRenderState {
  id: EntityId;
  kind: EntityKind;
  visible: boolean;
  opacity: number;
  focusProgress: number;
  traceProgress: number;
  transform: StoryTransform;
  comparison?: ComparisonChange;
  highlightStyle?: string;
  annotation?: string;
}

interface SceneSample {
  readonly scene: Scene;
  readonly index: number;
  readonly startedAtMs: number;
  readonly progress: number;
}

function sampleScene(story: Story, timestampMs: number): SceneSample | null {
  if (story.scenes.length === 0) {
    return null;
  }

  let startedAtMs = 0;
  for (let index = 0; index < story.scenes.length; index += 1) {
    const scene = story.scenes[index];
    const endsAtMs = startedAtMs + scene.durationMs;
    const isLast = index === story.scenes.length - 1;
    if (timestampMs < endsAtMs || isLast) {
      const progress =
        scene.durationMs === 0
          ? 1
          : Math.min(
              1,
              Math.max(0, (timestampMs - startedAtMs) / scene.durationMs),
            );
      return { scene, index, startedAtMs, progress };
    }
    startedAtMs = endsAtMs;
  }

  return null;
}

function applyEntityAction(
  states: Map<EntityId, MutableEntityRenderState>,
  action: Action,
  progress: number,
): void {
  if (action.type === "camera") {
    return;
  }

  if (action.type === "focus") {
    const state = states.get(action.target);
    if (state) {
      state.focusProgress = Math.max(state.focusProgress, progress);
    }
    return;
  }

  const state = states.get(action.target);
  if (!state) {
    return;
  }

  switch (action.type) {
    case "reveal":
      state.opacity += (1 - state.opacity) * progress;
      state.visible = state.opacity > 0;
      break;
    case "hide":
      state.opacity *= 1 - progress;
      state.visible = state.opacity > 0;
      break;
    case "trace":
      state.traceProgress = Math.max(state.traceProgress, progress);
      break;
    case "transform":
      state.transform = interpolateTransform(
        state.transform,
        action.to,
        progress,
      );
      break;
    case "compare":
      if (progress > 0) {
        state.comparison = action.change;
      }
      break;
    case "highlight":
      if (progress > 0) {
        state.highlightStyle = action.style;
      }
      break;
    case "annotate":
      if (progress > 0) {
        state.annotation = action.text;
      }
      break;
  }
}

function interpolateTransform(
  from: StoryTransform,
  to: StoryTransform,
  progress: number,
): StoryTransform {
  return {
    translateX: interpolateNumber(from.translateX, to.translateX, progress),
    translateY: interpolateNumber(from.translateY, to.translateY, progress),
    scale: interpolateNumber(from.scale, to.scale, progress),
    rotateDeg: interpolateNumber(from.rotateDeg, to.rotateDeg, progress),
  };
}

function interpolateNumber(from: number, to: number, progress: number): number {
  if (progress <= 0) {
    return from;
  }
  if (progress >= 1) {
    return to;
  }
  const crossesZero = (from < 0 && to >= 0) || (from >= 0 && to < 0);
  const value = crossesZero
    ? from * (1 - progress) + to * progress
    : from + (to - from) * progress;
  if (!Number.isFinite(value)) {
    throw new RangeError(
      "Transform interpolation produced a non-finite value.",
    );
  }
  return value;
}

function isPersistentAction(action: Action): boolean {
  return (
    action.type === "reveal" ||
    action.type === "hide" ||
    action.type === "transform"
  );
}

function sameFocus(
  left: readonly EntityId[],
  right: readonly EntityId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entityId, index) => entityId === right[index])
  );
}

function endpointName(
  entityId: EntityId,
  entities: Map<EntityId, GraphEntity>,
): string {
  const entity = entities.get(entityId);
  if (!entity) {
    return entityId;
  }
  return entity.kind === "edge" ? (entity.label ?? entity.id) : entity.label;
}

function entityName(
  entity: GraphEntity,
  entities: Map<EntityId, GraphEntity>,
): string {
  switch (entity.kind) {
    case "node":
    case "group":
      return entity.label;
    case "edge": {
      if (entity.label) {
        return entity.label;
      }
      return `${endpointName(entity.source, entities)} to ${endpointName(
        entity.target,
        entities,
      )}`;
    }
  }
}

function describeAction(
  action: Action,
  entities: Map<EntityId, GraphEntity>,
): string {
  const name = (target: EntityId): string => {
    const entity = entities.get(target);
    return entity ? entityName(entity, entities) : target;
  };

  switch (action.type) {
    case "reveal":
      return `Reveal ${name(action.target)}`;
    case "hide":
      return `Hide ${name(action.target)}`;
    case "focus":
      return `Focus on ${name(action.target)}`;
    case "trace":
      return `Trace ${name(action.target)}`;
    case "transform":
      return `Transform ${name(action.target)}`;
    case "compare":
      return `Compare ${name(action.target)}: ${action.change}`;
    case "highlight":
      return `Highlight ${name(action.target)}`;
    case "annotate":
      return `${name(action.target)}: ${action.text}`;
    case "camera":
      return action.focus.length === 0
        ? "Frame the whole diagram"
        : `Frame ${action.focus.map(name).join(", ")}`;
  }
}

function motionMode(preferences: PlaybackPreferences | undefined): MotionMode {
  if (preferences?.staticFallback) {
    return "static";
  }
  return preferences?.reducedMotion ? "reduced" : "full";
}

function decodeRenderInput<T>(scope: "snapshot" | "story", decode: () => T): T {
  try {
    return decode();
  } catch (error) {
    if (error instanceof DomainDecodeError) {
      throw new StoryRenderInputError([
        { scope, code: "invalid-structure", message: error.message },
      ]);
    }
    throw error;
  }
}

function assertFiniteRenderState(state: StoryRenderState): void {
  const values = [
    state.timestampMs,
    state.durationMs,
    state.transitionProgress,
    state.camera.progress,
    ...(state.activeScene
      ? [
          state.activeScene.startedAtMs,
          state.activeScene.durationMs,
          state.activeScene.progress,
          state.activeScene.index,
        ]
      : []),
    ...state.entities.flatMap((entity) => [
      entity.opacity,
      entity.focusProgress,
      entity.traceProgress,
      entity.transform.translateX,
      entity.transform.translateY,
      entity.transform.scale,
      entity.transform.rotateDeg,
    ]),
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("Render state contains a non-finite numeric value.");
  }
}

export function renderStoryAt(input: RenderStoryAtInput): StoryRenderState {
  if (!Number.isFinite(input.timestampMs)) {
    throw new RangeError("timestampMs must be finite.");
  }

  const snapshot = decodeRenderInput("snapshot", () =>
    decodeGraphSnapshot(input.snapshot),
  );
  const story = decodeRenderInput("story", () => decodeStory(input.story));
  const validationErrors: RenderInputIssue[] = [
    ...validateGraphSnapshot(snapshot).map((issue) => ({
      ...issue,
      scope: "snapshot" as const,
    })),
    ...validateStory(story, snapshot).map((issue) => ({
      ...issue,
      scope: "story" as const,
    })),
  ];
  if (validationErrors.length > 0) {
    throw new StoryRenderInputError(validationErrors);
  }

  const durationMs = storyDurationMs(story);
  const timestampMs = Math.min(durationMs, Math.max(0, input.timestampMs));
  const sample = sampleScene(story, timestampMs);
  const mode = motionMode(input.preferences);
  const transitionProgress = sample
    ? mode === "full"
      ? sample.progress
      : 1
    : 1;
  const entitiesById = new Map(
    snapshot.entities.map((entity) => [entity.id, entity]),
  );
  const states = new Map<EntityId, MutableEntityRenderState>(
    snapshot.entities.map((entity) => [
      entity.id,
      {
        id: entity.id,
        kind: entity.kind,
        visible: false,
        opacity: 0,
        focusProgress: 0,
        traceProgress: 0,
        transform: identityTransform(),
      },
    ]),
  );

  let cameraFocus: readonly EntityId[] = [];
  for (let index = 0; index < (sample?.index ?? 0); index += 1) {
    for (const action of story.scenes[index].actions) {
      if (action.type === "camera") {
        cameraFocus = [...action.focus];
      } else if (isPersistentAction(action)) {
        applyEntityAction(states, action, 1);
      }
    }
  }

  const cameraFrom = cameraFocus;
  let cameraTo = cameraFocus;
  if (sample) {
    for (const action of sample.scene.actions) {
      if (action.type === "camera") {
        cameraTo = [...action.focus];
      } else {
        applyEntityAction(states, action, transitionProgress);
      }
    }
  }

  const cameraProgress = sameFocus(cameraFrom, cameraTo)
    ? 1
    : transitionProgress;
  const renderedCameraFocus = mode === "full" ? cameraFrom : cameraTo;

  const state: StoryRenderState = {
    timestampMs,
    durationMs,
    motionMode: mode,
    transitionProgress,
    activeScene: sample
      ? {
          id: sample.scene.id,
          title: sample.scene.title,
          index: sample.index,
          startedAtMs: sample.startedAtMs,
          durationMs: sample.scene.durationMs,
          progress: sample.progress,
        }
      : null,
    entities: [...states.values()],
    camera: {
      from: [...renderedCameraFocus],
      to: [...cameraTo],
      progress: cameraProgress,
    },
    communication: sample
      ? {
          sceneTitle: sample.scene.title,
          descriptions: sample.scene.actions.map((action) =>
            describeAction(action, entitiesById),
          ),
        }
      : null,
  };
  assertFiniteRenderState(state);
  return state;
}
