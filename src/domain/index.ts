export {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  type SchemaVersion,
  type Versioned,
  type Migration,
  MIGRATIONS,
  isSupportedSchemaVersion,
  isCurrentSchemaVersion,
  assertCurrentSchemaVersion,
  migrateDocument,
} from "@/domain/schema-version";

export {
  type EntityId,
  type SnapshotId,
  type EntityKind,
  type NodeEntity,
  type EdgeEntity,
  type GroupEntity,
  type GraphEntity,
  type LayoutHint,
  type ImporterMetadata,
  type MermaidSource,
  type GraphSnapshot,
  type CreateGraphSnapshotInput,
  type GraphValidationCode,
  type GraphValidationError,
  entityId,
  snapshotId,
  createGraphSnapshot,
  validateGraphSnapshot,
} from "@/domain/graph";

export {
  type StoryId,
  type SceneId,
  type StoryTransform,
  type ComparisonChange,
  type Action,
  type Scene,
  type Story,
  type CreateStoryInput,
  type StoryValidationCode,
  type StoryValidationError,
  ACTION_TYPES,
  storyId,
  sceneId,
  createStory,
  validateStory,
  storyDurationMs,
} from "@/domain/story";

export {
  type EntityRenderState,
  type CameraRenderState,
  type ActiveSceneRenderState,
  type MotionMode,
  type PlaybackPreferences,
  type SceneCommunication,
  type StoryRenderState,
  type RenderStoryAtInput,
  type RenderInputIssue,
  StoryRenderInputError,
  renderStoryAt,
} from "@/domain/story-engine";

export {
  type ComparisonId,
  type EntityChange,
  type Comparison,
  type ComparisonValidationCode,
  type ComparisonValidationError,
  comparisonId,
  compareSnapshots,
  validateComparison,
} from "@/domain/comparison";

export {
  type AgentEntity,
  type AgentGraphView,
  type AgentContextPackage,
  type BuildAgentContextInput,
  buildAgentContextPackage,
} from "@/domain/agent-context";

export {
  type ProjectId,
  type ProjectDocument,
  type CreateProjectDocumentInput,
  type ProjectValidationError,
  projectId,
  createProjectDocument,
  validateProjectDocument,
  isValidProjectDocument,
} from "@/domain/project-document";

export {
  serializeProjectDocument,
  parseProjectDocument,
} from "@/domain/serialization";

export {
  DomainDecodeError,
  decodeGraphEntity,
  decodeGraphSnapshot,
  decodeAction,
  decodeStory,
  decodeComparison,
  decodeProjectDocument,
} from "@/domain/runtime-decoder";

export {
  currentArchitectureSnapshot,
  proposedArchitectureSnapshot,
  sampleProjectDocument,
} from "@/domain/fixtures";
