export {
  CURRENT_SCHEMA_VERSION,
  type SchemaVersion,
  type Versioned,
  isCurrentSchemaVersion,
  assertCurrentSchemaVersion,
} from "@/domain/schema-version";

export {
  type NodeId,
  type EdgeId,
  type SubgraphId,
  type GraphNode,
  type GraphEdge,
  type Subgraph,
  type ProjectGraph,
  type CreateProjectGraphInput,
  type GraphValidationError,
  nodeId,
  edgeId,
  subgraphId,
  createProjectGraph,
  validateProjectGraph,
} from "@/domain/project-graph";

export {
  type SceneId,
  type StepId,
  type ElementRef,
  type Action,
  type Step,
  type Scene,
  type SceneDocument,
  type CreateSceneDocumentInput,
  type SceneValidationError,
  ACTION_TYPES,
  sceneId,
  stepId,
  createSceneDocument,
  validateSceneDocument,
} from "@/domain/scene-document";

export {
  type Project,
  type CreateProjectInput,
  type ProjectValidationError,
  createProject,
  createProjectFromSource,
  validateProject,
} from "@/domain/project";
