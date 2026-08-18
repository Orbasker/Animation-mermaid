/**
 * The acceptance flowchart for ANI-9. It is byte-for-byte the source of
 * {@link currentArchitectureSnapshot}, so importing it must reproduce that hand-built model
 * exactly — the strongest possible check that the importer and the reference domain agree.
 */
export const ACCEPTANCE_FLOWCHART = [
  "flowchart TD",
  "  client[Client]",
  "  subgraph backend[Backend]",
  "    api[API Gateway]",
  "    service[Orders Service]",
  "  end",
  "  db[(Database)]",
  "  client --> api",
  "  api --> service",
  "  service --> db",
].join("\n");

/**
 * A flowchart exercising the full supported surface: several node shapes, labeled / dotted /
 * thick edges, chained edges, and nested subgraphs. Used to prove shape and edge mapping.
 */
export const RICH_FLOWCHART = [
  "flowchart LR",
  "  %% a comment that must be ignored",
  "  start((Start))",
  "  subgraph app[Application]",
  "    ui[/User Input/]",
  "    subgraph core[Core]",
  "      decide{Valid?}",
  "      work[[Process]]",
  "    end",
  "  end",
  "  store[(Store)]",
  "  done([Done])",
  "  start --> ui",
  "  ui -->|submit| decide",
  "  decide -- yes --> work --> store",
  "  decide -. no .-> done",
  "  work ==> done",
].join("\n");

/**
 * A flowchart full of unsafe and unsupported constructs: an init directive, a script-laden
 * label, a `click` interaction, a `classDef`, and an `&` fan-out edge. Used to prove that
 * malicious input is sanitized and unsupported syntax yields actionable diagnostics — while
 * the safe parts still import.
 */
export const HOSTILE_FLOWCHART = [
  "%%{init: {'theme':'dark'}}%%",
  "flowchart TD",
  '  a["<script>alert(1)</script>Login"]',
  "  b[Home]",
  "  a --> b",
  "  c & d --> b",
  '  click a "javascript:steal()"',
  "  classDef danger fill:#f00",
  "  a ~~~ b",
].join("\n");

/**
 * Builds a dense but valid flowchart of `nodeCount` nodes wired into a chain with periodic
 * cross-links, distributed across `groupCount` subgraphs. It is the worker stress fixture:
 * large enough that parsing and ELK layout are visibly CPU-heavy, so a browser test can prove
 * the work runs off the UI thread, yet deterministic so results are reproducible.
 */
export function buildStressFlowchart(
  nodeCount: number,
  groupCount = 8,
): string {
  const count = Math.max(1, Math.floor(nodeCount));
  const groups = Math.max(1, Math.min(groupCount, count));
  const perGroup = Math.ceil(count / groups);

  const lines: string[] = ["flowchart TD"];
  for (let g = 0; g < groups; g += 1) {
    lines.push(`  subgraph group_${g}[Group ${g + 1}]`);
    for (
      let i = g * perGroup;
      i < Math.min((g + 1) * perGroup, count);
      i += 1
    ) {
      lines.push(`    n${i}[Service ${i + 1}]`);
    }
    lines.push("  end");
  }
  for (let i = 1; i < count; i += 1) {
    lines.push(`  n${i - 1} --> n${i}`);
  }
  // Sparse cross-links so the layered layout has real work to do, not just a straight line.
  for (let i = 0; i + 7 < count; i += 7) {
    lines.push(`  n${i} -.-> n${i + 7}`);
  }
  return lines.join("\n");
}

/** The agreed default stress size exercised by the worker unit and browser tests. */
export const STRESS_FLOWCHART_NODE_COUNT = 400;

/** A ready-made large flowchart at {@link STRESS_FLOWCHART_NODE_COUNT}. */
export const STRESS_FLOWCHART = buildStressFlowchart(
  STRESS_FLOWCHART_NODE_COUNT,
);
