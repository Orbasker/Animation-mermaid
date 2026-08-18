import {
  CURRENT_SCHEMA_VERSION,
  type Versioned,
} from "@/domain/schema-version";
import type { EdgeId, NodeId, ProjectGraph } from "@/domain/project-graph";

/** Stable identifiers for storyboard elements. */
export type SceneId = string & { readonly __brand: "SceneId" };
export type StepId = string & { readonly __brand: "StepId" };

export function sceneId(value: string): SceneId {
  return value as SceneId;
}

export function stepId(value: string): StepId {
  return value as StepId;
}

/** A graph element a step can act on. */
export type ElementRef =
  | { readonly kind: "node"; readonly id: NodeId }
  | { readonly kind: "edge"; readonly id: EdgeId };

/**
 * A single animation instruction inside a step. Actions form a discriminated union keyed
 * by `type` so new action kinds can be added with exhaustive type checking.
 */
export type Action =
  | { readonly type: "reveal"; readonly target: ElementRef }
  | { readonly type: "hide"; readonly target: ElementRef }
  | {
      readonly type: "highlight";
      readonly target: ElementRef;
      /** Optional named emphasis style, resolved by the renderer. */
      readonly style?: string;
    }
  | {
      readonly type: "style";
      readonly target: ElementRef;
      /** Arbitrary key/value visual overrides applied for the remainder of the scene. */
      readonly properties: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "camera";
      /** Element(s) to frame; empty means fit the whole diagram. */
      readonly focus: readonly ElementRef[];
    };

export const ACTION_TYPES = [
  "reveal",
  "hide",
  "highlight",
  "style",
  "camera",
] as const satisfies readonly Action["type"][];

/**
 * A step is the smallest unit of playback: a group of actions applied together with a
 * shared duration. Steps within a scene play in array order.
 */
export interface Step {
  readonly id: StepId;
  /** Playback duration of this step, in milliseconds. */
  readonly durationMs: number;
  readonly actions: readonly Action[];
}

/** A scene is a titled sequence of steps — a chapter of the animation. */
export interface Scene {
  readonly id: SceneId;
  readonly title: string;
  readonly steps: readonly Step[];
}

/**
 * The storyboard layered over a {@link ProjectGraph}: an ordered list of scenes that
 * describe *how* the diagram animates over time. It references graph elements by ID and
 * does not embed the graph itself, so the two can version independently within a
 * {@link Project}.
 */
export interface SceneDocument extends Versioned {
  readonly scenes: readonly Scene[];
}

export interface CreateSceneDocumentInput {
  readonly scenes?: readonly Scene[];
}

/** Builds a {@link SceneDocument} at the current schema version. */
export function createSceneDocument(
  input: CreateSceneDocumentInput = {},
): SceneDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    scenes: input.scenes ?? [],
  };
}

export interface SceneValidationError {
  readonly code:
    | "duplicate-scene-id"
    | "duplicate-step-id"
    | "negative-duration"
    | "action-missing-element";
  readonly message: string;
}

function elementExists(graph: ProjectGraph, ref: ElementRef): boolean {
  if (ref.kind === "node") {
    return graph.nodes.some((node) => node.id === ref.id);
  }
  return graph.edges.some((edge) => edge.id === ref.id);
}

function actionTargets(action: Action): readonly ElementRef[] {
  switch (action.type) {
    case "reveal":
    case "hide":
    case "highlight":
    case "style":
      return [action.target];
    case "camera":
      return action.focus;
  }
}

/**
 * Validates a scene document against the graph it animates: unique scene/step IDs,
 * non-negative durations, and every referenced element existing in `graph`. Returns all
 * problems found rather than throwing.
 */
export function validateSceneDocument(
  document: SceneDocument,
  graph: ProjectGraph,
): readonly SceneValidationError[] {
  const errors: SceneValidationError[] = [];

  const sceneIds = new Set<SceneId>();
  const stepIds = new Set<StepId>();

  for (const scene of document.scenes) {
    if (sceneIds.has(scene.id)) {
      errors.push({
        code: "duplicate-scene-id",
        message: `Duplicate scene id: ${scene.id}`,
      });
    }
    sceneIds.add(scene.id);

    for (const step of scene.steps) {
      if (stepIds.has(step.id)) {
        errors.push({
          code: "duplicate-step-id",
          message: `Duplicate step id: ${step.id}`,
        });
      }
      stepIds.add(step.id);

      if (step.durationMs < 0) {
        errors.push({
          code: "negative-duration",
          message: `Step ${step.id} has negative duration ${step.durationMs}`,
        });
      }

      for (const action of step.actions) {
        for (const target of actionTargets(action)) {
          if (!elementExists(graph, target)) {
            errors.push({
              code: "action-missing-element",
              message: `Step ${step.id} ${action.type} references unknown ${target.kind} ${target.id}`,
            });
          }
        }
      }
    }
  }

  return errors;
}
