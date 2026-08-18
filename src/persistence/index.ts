export {
  openDatabase,
  promisifyRequest,
  runTransaction,
  type UpgradeDatabase,
} from "@/persistence/idb";

export {
  ProjectRepository,
  RepositoryError,
  type ProjectMeta,
  type StoredProject,
  type ProjectListEntry,
  type AiRunReference,
  type RepositoryErrorCode,
  type ProjectRepositoryOptions,
} from "@/persistence/project-repository";
