import {
  CURRENT_SCHEMA_VERSION,
  type Versioned,
} from "@/domain/schema-version";
import {
  createProjectGraph,
  validateProjectGraph,
  type ProjectGraph,
} from "@/domain/project-graph";
import {
  createSceneDocument,
  validateSceneDocument,
  type SceneDocument,
} from "@/domain/scene-document";

/**
 * The top-level persisted unit of work: a {@link ProjectGraph} (the diagram) paired with
 * a {@link SceneDocument} (its animation). The wrapper is versioned independently of the
 * two documents it holds so the container format can evolve on its own.
 */
export interface Project extends Versioned {
  readonly name: string;
  readonly graph: ProjectGraph;
  readonly scenes: SceneDocument;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly graph: ProjectGraph;
  readonly scenes?: SceneDocument;
}

/**
 * Builds a {@link Project} at the current schema version. When no scene document is
 * supplied an empty one is created, so a freshly-imported diagram is a valid project with
 * no animation yet.
 */
export function createProject(input: CreateProjectInput): Project {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: input.name,
    graph: input.graph,
    scenes: input.scenes ?? createSceneDocument(),
  };
}

export interface ProjectValidationError {
  readonly scope: "graph" | "scenes";
  readonly code: string;
  readonly message: string;
}

/**
 * Validates a project end to end by running {@link validateProjectGraph} and
 * {@link validateSceneDocument} (the latter against this project's own graph) and tagging
 * each error with the document it came from.
 */
export function validateProject(
  project: Project,
): readonly ProjectValidationError[] {
  const graphErrors = validateProjectGraph(project.graph).map(
    (error): ProjectValidationError => ({ scope: "graph", ...error }),
  );
  const sceneErrors = validateSceneDocument(project.scenes, project.graph).map(
    (error): ProjectValidationError => ({ scope: "scenes", ...error }),
  );
  return [...graphErrors, ...sceneErrors];
}

/** Creates an empty project from Mermaid source with no scenes authored yet. */
export function createProjectFromSource(input: {
  readonly name: string;
  readonly diagramType: string;
  readonly source: string;
}): Project {
  return createProject({
    name: input.name,
    graph: createProjectGraph({
      diagramType: input.diagramType,
      source: input.source,
    }),
  });
}
