export {
  openDatabase,
  promisifyRequest,
  runTransaction,
  type UpgradeDatabase,
} from "@/persistence/idb";

export {
  ProjectRepository,
  RepositoryError,
  BACKUP_FORMAT,
  type ProjectMeta,
  type StoredProject,
  type ProjectListEntry,
  type RepositoryErrorCode,
  type ProjectRepositoryOptions,
  type RecoveryReason,
  type RecoveryEntry,
  type RecoveryReport,
  type ProjectBackup,
  type RestoreReport,
} from "@/persistence/project-repository";

export {
  probeStorageHealth,
  type StorageHealth,
  type StorageHealthStatus,
  type StorageHealthProbeOptions,
  type StorageManagerLike,
} from "@/persistence/storage-health";
