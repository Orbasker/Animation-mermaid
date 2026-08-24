/**
 * The acceptance DOT diagram: a client talking to an API that fronts a service and a database,
 * with the API and service grouped as a `cluster_backend`. It mirrors the reference architecture
 * so importing it must reproduce the same normalized shape the Mermaid acceptance fixture does —
 * the strongest check that DOT imports through the same graph boundary.
 */
export const ACCEPTANCE_DOT = [
  "digraph Architecture {",
  "  rankdir=TB;",
  '  client [label="Client"];',
  "  subgraph cluster_backend {",
  '    label="Backend";',
  '    api [label="API Gateway"];',
  '    service [label="Orders Service"];',
  "  }",
  '  db [label="Database", shape=cylinder];',
  "  client -> api;",
  "  api -> service;",
  "  service -> db;",
  "}",
].join("\n");

/**
 * A DOT diagram exercising the fuller supported surface: `rankdir`, node shapes, labeled and
 * styled (dashed / bold) edges, a chained edge, and nested `cluster_*` subgraphs for drill-down.
 */
export const RICH_DOT = [
  "// a comment that must be ignored",
  "digraph Rich {",
  "  rankdir=LR",
  '  start [label="Start", shape=circle]',
  "  subgraph cluster_app {",
  '    label="Application"',
  '    ui [label="User Input"]',
  "    subgraph cluster_core {",
  '      label="Core"',
  '      decide [label="Valid?", shape=diamond]',
  '      work [label="Process"]',
  "    }",
  "  }",
  '  store [label="Store", shape=cylinder]',
  '  done [label="Done"]',
  "  start -> ui",
  '  ui -> decide [label="submit"]',
  '  decide -> work [label="yes"]',
  "  work -> store",
  '  decide -> done [style=dashed, label="no"]',
  "  work -> done [style=bold]",
  "}",
].join("\n");

/**
 * A DOT diagram full of unsupported and unsafe constructs: an HTML-like label, a script-laden
 * label, a `node`/`edge` default-attribute statement, a port on an edge endpoint, and an edge to a
 * subgraph. Used to prove that malicious input is sanitized and unsupported syntax yields
 * actionable diagnostics — while the safe parts still import.
 */
export const HOSTILE_DOT = [
  "digraph Hostile {",
  "  node [color=red];",
  '  a [label="<script>alert(1)</script>Login"];',
  '  b [label="Home"];',
  "  a:port0 -> b;",
  "  a -> { b };",
  "  c [label=<<b>Bold</b>>];",
  "  a -> b;",
  "}",
].join("\n");
