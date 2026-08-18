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
  type VisualGroup,
  type GraphAnnotation,
  type GraphViewState,
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
  type StoryValidationTarget,
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
  withIdentityMap,
} from "@/domain/comparison";

export {
  type IdentityPair,
  type IdentityMap,
  EMPTY_IDENTITY_MAP,
  confirmIdentity,
  rejectIdentity,
  isConfirmed,
  isRejected,
} from "@/domain/identity-map";

export {
  type MatchStrategy,
  type EntityMatch,
  type MatchSuggestion,
  type MatchResult,
  type ChangeCategory,
  type ChangeRecord,
  type ArchitectureDiff,
  type MatchOptions,
  type SideStatus,
  type SideEntity,
  type SideBySideView,
  type OverlayEntity,
  type OverlayView,
  type CompareStoryInput,
  CHANGE_CATEGORIES,
  recordEntityId,
  matchEntities,
  diffArchitectures,
  filterChanges,
  changeCategoryLabel,
  buildSideBySideView,
  buildOverlayView,
  buildCompareSnapshot,
  changesToCompareStory,
} from "@/domain/semantic-compare";

export {
  type AgentEntity,
  type AgentGraphView,
  type AgentContextPackage,
  type BuildAgentContextInput,
  buildAgentContextPackage,
  redactAgentContext,
} from "@/domain/agent-context";

export {
  type StoryApplicationMode,
  type SceneApplication,
  type StoryApplicationPlan,
  StoryNotApplicableError,
  planStoryApplication,
  applyStoryProposal,
} from "@/domain/apply-proposal";

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
  type EditorTransaction,
  type EditorHistory,
  applyEditorTransaction,
  createEditorHistory,
  commitEditorTransaction,
  undoEditorHistory,
  redoEditorHistory,
  reconcileImportedSnapshot,
  createStressSnapshot,
} from "@/domain/editor";

export {
  currentArchitectureSnapshot,
  proposedArchitectureSnapshot,
  sampleProjectDocument,
} from "@/domain/fixtures";

export {
  type Direction,
  type NodeShape,
  type EdgeLineStyle,
  type EdgeArrow,
  type DiagnosticSeverity,
  type MermaidDiagnosticCode,
  type MermaidDiagnostic,
  type MermaidImportResult,
  type ParsedNode,
  type ParsedEdge,
  type ParsedGroup,
  type ParsedFlowchart,
  type ImportMermaidInput,
  type LayoutOverride,
  type LayoutOptions,
  DIRECTIONS,
  DEFAULT_DIRECTION,
  MERMAID_IMPORTER,
  MERMAID_IMPORTER_VERSION,
  parseFlowchart,
  importMermaidFlowchart,
  reconnectedEntityIds,
  layoutFlowchart,
  mergeLayoutOverrides,
  ACCEPTANCE_FLOWCHART,
  RICH_FLOWCHART,
  HOSTILE_FLOWCHART,
} from "@/domain/mermaid";
