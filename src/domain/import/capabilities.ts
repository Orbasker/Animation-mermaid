import type { ImporterCapabilities } from "@/domain/import/contract";
import { FLOWCHART_CAPABILITIES } from "@/domain/mermaid/capabilities";
import { SEQUENCE_CAPABILITIES } from "@/domain/mermaid/sequence/import";

/**
 * The capability report for every registered importer. Defined here — free of the ELK layout
 * dependency the importer objects pull in — so UI surfaces can render "what each importer
 * supports" without bundling the layout engine. The registry's runtime importer list is kept
 * in the same order.
 */
export const IMPORTER_CAPABILITIES: readonly ImporterCapabilities[] = [
  FLOWCHART_CAPABILITIES,
  SEQUENCE_CAPABILITIES,
];
