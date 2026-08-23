import {
  buildStructureDiagram,
  StructureDiagramError,
} from "@/preview/structure-model";

/**
 * Browser entry bundled into the exported explorer. It exposes the app's real Mermaid importer
 * on `window.__STRUCTURE__` so the in-page editor re-derives a diagram model from edited source
 * through exactly the same code path as the build-time generator — no separate parser to drift.
 * ELK layout stays out of this bundle (it is inlined separately), so only parsing ships here.
 */
declare global {
  interface Window {
    __STRUCTURE__?: {
      buildStructureDiagram: typeof buildStructureDiagram;
      StructureDiagramError: typeof StructureDiagramError;
    };
  }
}

window.__STRUCTURE__ = { buildStructureDiagram, StructureDiagramError };
