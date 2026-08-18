export {
  type DiagnosticSeverity,
  type ImportDiagnostic,
  type FeatureSupport,
  type ImporterFeature,
  type ImporterCapabilities,
  type DiagramImportInput,
  type DiagramImportResult,
  type DiagramImporter,
} from "@/domain/import/contract";

export { firstSignificantLine } from "@/domain/import/source";

export { IMPORTER_CAPABILITIES } from "@/domain/import/capabilities";

export {
  IMPORTERS,
  listImporterCapabilities,
  detectImporter,
  importerById,
  importerByDiagramType,
  importDiagram,
} from "@/domain/import/registry";
