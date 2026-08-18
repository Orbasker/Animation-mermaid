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
