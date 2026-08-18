import { sanitizeLabel } from "@/domain/mermaid/sanitize";
import {
  DEFAULT_DIRECTION,
  DIRECTIONS,
  type Direction,
  type EdgeArrow,
  type EdgeLineStyle,
  type MermaidDiagnostic,
  type MermaidDiagnosticCode,
  type NodeShape,
} from "@/domain/mermaid/types";

/** A node discovered in the source, keyed by its source id (the semantic key). */
export interface ParsedNode {
  readonly id: string;
  readonly label: string;
  readonly shape: NodeShape;
  /** Innermost subgraph the node was first mentioned in, if any. */
  readonly groupId?: string;
}

/** A directed edge between two source ids. */
export interface ParsedEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly line: EdgeLineStyle;
  readonly arrow: EdgeArrow;
}

/** A subgraph and its direct members (nodes and nested subgraphs), in mention order. */
export interface ParsedGroup {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly string[];
}

/** The structural result of parsing a flowchart, plus every diagnostic gathered. */
export interface ParsedFlowchart {
  readonly direction: Direction;
  readonly nodes: readonly ParsedNode[];
  readonly groups: readonly ParsedGroup[];
  readonly edges: readonly ParsedEdge[];
  readonly diagnostics: readonly MermaidDiagnostic[];
  /** Set when a fatal diagnostic (bad header / empty source) prevented parsing. */
  readonly fatal: boolean;
}

const SHAPE_WRAPPERS: readonly {
  readonly open: string;
  readonly close: string;
  readonly shape: NodeShape;
}[] = [
  { open: "[[", close: "]]", shape: "subroutine" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "[/", close: "/]", shape: "parallelogram" },
  { open: "[/", close: "\\]", shape: "trapezoid" },
  { open: "[\\", close: "/]", shape: "trapezoid-alt" },
  { open: "[\\", close: "\\]", shape: "parallelogram-alt" },
  { open: "([", close: "])", shape: "stadium" },
  { open: "((", close: "))", shape: "circle" },
  { open: "{{", close: "}}", shape: "hexagon" },
  { open: "[", close: "]", shape: "rectangle" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
  { open: ">", close: "]", shape: "asymmetric" },
];

const HEADER_RE = /^(?:flowchart|graph)(?:\s+([A-Za-z]{2}))?\s*$/;
const NODE_ID_RE = /^[A-Za-z0-9_]+/;

const INLINE_LABEL_RE = /^(--|==|-\.)\s+(\S.*?)\s+(-->|==>|\.->|--x|--o)/;
const PIPE_OP_RE =
  /^(<?-{2,}>|<?={2,}>|-\.-*->|-{2,}[xo]|-{2,}|={2,}|-\.-*)\s*\|([^|]*)\|/;
const PLAIN_OP_RE =
  /^(<?-{2,}>|<?={2,}>|-\.-*->|-{2,}[xo]|-{2,}|={2,}|-\.-*|-\.-)/;

function connectorStyle(op: string): { line: EdgeLineStyle; arrow: EdgeArrow } {
  const line: EdgeLineStyle = op.includes(".")
    ? "dotted"
    : op.includes("=")
      ? "thick"
      : "solid";
  const arrow: EdgeArrow = op.endsWith("x")
    ? "cross"
    : op.endsWith("o")
      ? "circle"
      : op.endsWith(">")
        ? "normal"
        : "open";
  return { line, arrow };
}

interface ConnectorMatch {
  readonly length: number;
  readonly label?: string;
  readonly line: EdgeLineStyle;
  readonly arrow: EdgeArrow;
}

/** Reads a single edge connector (with optional inline or pipe label) anchored at `text[0]`. */
function readConnector(text: string): ConnectorMatch | null {
  const inline = INLINE_LABEL_RE.exec(text);
  if (inline) {
    const { line, arrow } = connectorStyle(inline[1] + inline[3]);
    return { length: inline[0].length, label: inline[2], line, arrow };
  }
  const pipe = PIPE_OP_RE.exec(text);
  if (pipe) {
    const { line, arrow } = connectorStyle(pipe[1]);
    return { length: pipe[0].length, label: pipe[2], line, arrow };
  }
  const plain = PLAIN_OP_RE.exec(text);
  if (plain) {
    const { line, arrow } = connectorStyle(plain[1]);
    return { length: plain[0].length, line, arrow };
  }
  return null;
}

const CLOSERS: Readonly<Record<string, string>> = {
  "[": "]",
  "(": ")",
  "{": "}",
};

type ChainResult =
  | {
      readonly ok: true;
      readonly chunks: string[];
      readonly links: ConnectorMatch[];
    }
  | {
      readonly ok: false;
      readonly reason: "ampersand" | "syntax";
      readonly offset: number;
    };

/**
 * Splits an edge statement into its node chunks and the connectors between them, walking the
 * string bracket-aware (and quote-aware) so dashes inside `[labels]` never look like links.
 * `A --> B --> C` yields three chunks and two links. `&` (multi-node fan-out) is reported as
 * unsupported rather than silently mis-parsed.
 */
function tokenizeChain(stmt: string): ChainResult {
  const chunks: string[] = [];
  const links: ConnectorMatch[] = [];
  let buf = "";
  let i = 0;
  let depth = 0;
  let inString = false;

  while (i < stmt.length) {
    const c = stmt[i];

    if (inString) {
      buf += c;
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (depth > 0) {
      buf += c;
      if (c === '"') inString = true;
      else if (c in CLOSERS) depth += 1;
      else if (c === "]" || c === ")" || c === "}") depth -= 1;
      i += 1;
      continue;
    }

    if (c === '"') {
      inString = true;
      buf += c;
      i += 1;
      continue;
    }
    if (c in CLOSERS) {
      depth += 1;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ">" && buf.trim().length > 0) {
      // `id>Label]` flag shape opens with `>` and closes with `]`.
      depth += 1;
      buf += c;
      i += 1;
      continue;
    }
    if (c === "&") {
      return { ok: false, reason: "ampersand", offset: i };
    }
    if (c === "-" || c === "=" || c === "<") {
      const connector = readConnector(stmt.slice(i));
      if (!connector) {
        return { ok: false, reason: "syntax", offset: i };
      }
      chunks.push(buf.trim());
      links.push(connector);
      buf = "";
      i += connector.length;
      continue;
    }
    buf += c;
    i += 1;
  }

  chunks.push(buf.trim());
  return { ok: true, chunks, links };
}

/** Parses a single node chunk (`client`, `db[(Database)]`, `X{{Hex}}`, …). */
function parseNodeChunk(
  chunk: string,
): { id: string; label: string; shape: NodeShape; sanitized: boolean } | null {
  const idMatch = NODE_ID_RE.exec(chunk);
  if (!idMatch) return null;
  const id = idMatch[0];
  const rest = chunk.slice(id.length);

  if (rest.length === 0) {
    return { id, label: id, shape: "rectangle", sanitized: false };
  }

  for (const { open, close, shape } of SHAPE_WRAPPERS) {
    if (
      rest.length >= open.length + close.length &&
      rest.startsWith(open) &&
      rest.endsWith(close)
    ) {
      const inner = rest.slice(open.length, rest.length - close.length);
      const { value, changed } = sanitizeLabel(inner);
      return {
        id,
        label: value.length > 0 ? value : id,
        shape,
        sanitized: changed,
      };
    }
  }
  return null;
}

interface ParserState {
  readonly nodes: Map<
    string,
    { id: string; label: string; shape: NodeShape; groupId?: string }
  >;
  readonly groups: Map<
    string,
    { id: string; label: string; memberIds: string[] }
  >;
  readonly edges: ParsedEdge[];
  readonly diagnostics: MermaidDiagnostic[];
  /** Stack of open subgraph ids (innermost last). */
  readonly subgraphStack: string[];
}

function currentGroup(state: ParserState): string | undefined {
  return state.subgraphStack[state.subgraphStack.length - 1];
}

/** Records a node reference, creating it (and its group membership) on first mention. */
function referenceNode(
  state: ParserState,
  parsed: { id: string; label: string; shape: NodeShape; sanitized: boolean },
  location: { line: number; column: number; snippet: string },
): void {
  if (parsed.sanitized) {
    state.diagnostics.push({
      code: "label-sanitized",
      severity: "warning",
      message: `Label for node "${parsed.id}" contained unsafe markup that was removed.`,
      line: location.line,
      column: location.column,
      snippet: location.snippet,
    });
  }

  const existing = state.nodes.get(parsed.id);
  if (!existing) {
    const group = currentGroup(state);
    state.nodes.set(parsed.id, {
      id: parsed.id,
      label: parsed.label,
      shape: parsed.shape,
      ...(group !== undefined ? { groupId: group } : {}),
    });
    if (group !== undefined) {
      state.groups.get(group)?.memberIds.push(parsed.id);
    }
    return;
  }

  // A later explicit shape/label refines the entry; identity and group are fixed at creation.
  if (parsed.shape !== "rectangle") {
    existing.shape = parsed.shape;
  }
  if (parsed.label !== parsed.id) {
    existing.label = parsed.label;
  }
}

const SUBGRAPH_WITH_TITLE_RE = /^([A-Za-z0-9_]+)\s*\[(.*)\]$/;
const SUBGRAPH_ID_ONLY_RE = /^([A-Za-z0-9_]+)$/;

function openSubgraph(
  state: ParserState,
  rest: string,
  location: { line: number; column: number; snippet: string },
): void {
  let id: string;
  let label: string;

  const titled = SUBGRAPH_WITH_TITLE_RE.exec(rest);
  const idOnly = SUBGRAPH_ID_ONLY_RE.exec(rest);
  if (titled) {
    id = titled[1];
    label = sanitizeLabel(titled[2]).value || titled[1];
  } else if (idOnly) {
    id = idOnly[1];
    label = idOnly[1];
  } else {
    // `subgraph "Some Title"` — derive a stable id from the sanitized title.
    const sanitized = sanitizeLabel(rest);
    label = sanitized.value || "subgraph";
    id =
      label.replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-+|-+$/g, "") ||
      "subgraph";
  }

  const parentGroup = currentGroup(state);
  if (
    parentGroup !== undefined &&
    !state.groups.get(parentGroup)?.memberIds.includes(id)
  ) {
    state.groups.get(parentGroup)?.memberIds.push(id);
  }
  if (!state.groups.has(id)) {
    state.groups.set(id, { id, label, memberIds: [] });
  }
  state.subgraphStack.push(id);
  void location;
}

function classifyKeyword(
  stmt: string,
): MermaidDiagnosticCode | "subgraph" | "end" | "direction" | null {
  const first = stmt.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  switch (first) {
    case "subgraph":
      return "subgraph";
    case "end":
      return stmt.trim().toLowerCase() === "end" ? "end" : null;
    case "direction":
      return "direction";
    case "classdef":
    case "class":
    case "style":
    case "linkstyle":
      return "styling-ignored";
    case "click":
      return "interaction-ignored";
    default:
      return null;
  }
}

function handleEdgeStatement(
  state: ParserState,
  stmt: string,
  location: { line: number; column: number },
): void {
  const result = tokenizeChain(stmt);
  if (!result.ok) {
    if (result.reason === "ampersand") {
      state.diagnostics.push({
        code: "unsupported-ampersand",
        severity: "warning",
        message:
          "Multi-node edges using `&` are not supported; split them into one edge per pair.",
        line: location.line,
        column: location.column + result.offset,
        snippet: stmt,
      });
    } else {
      state.diagnostics.push({
        code: "unrecognized-statement",
        severity: "warning",
        message: `Could not parse statement: "${stmt}".`,
        line: location.line,
        column: location.column,
        snippet: stmt,
      });
    }
    return;
  }

  const parsedNodes: {
    id: string;
    label: string;
    shape: NodeShape;
    sanitized: boolean;
  }[] = [];
  for (const chunk of result.chunks) {
    if (chunk.length === 0) {
      state.diagnostics.push({
        code: "empty-node-id",
        severity: "warning",
        message: `Edge statement has a missing endpoint: "${stmt}".`,
        line: location.line,
        column: location.column,
        snippet: stmt,
      });
      return;
    }
    const parsed = parseNodeChunk(chunk);
    if (!parsed) {
      state.diagnostics.push({
        code: "unrecognized-statement",
        severity: "warning",
        message: `Could not parse node "${chunk}" in statement: "${stmt}".`,
        line: location.line,
        column: location.column,
        snippet: stmt,
      });
      return;
    }
    parsedNodes.push(parsed);
  }

  for (const parsed of parsedNodes) {
    referenceNode(state, parsed, { ...location, snippet: stmt });
  }

  for (let k = 0; k < result.links.length; k += 1) {
    const connector = result.links[k];
    const source = parsedNodes[k].id;
    const target = parsedNodes[k + 1].id;
    const labelText = connector.label
      ? sanitizeLabel(connector.label).value
      : undefined;
    state.edges.push({
      source,
      target,
      ...(labelText ? { label: labelText } : {}),
      line: connector.line,
      arrow: connector.arrow,
    });
  }
}

function handleStatement(
  state: ParserState,
  stmt: string,
  location: { line: number; column: number },
): void {
  const kind = classifyKeyword(stmt);

  if (kind === "subgraph") {
    const rest = stmt.slice("subgraph".length).trim();
    openSubgraph(state, rest, { ...location, snippet: stmt });
    return;
  }
  if (kind === "end") {
    if (state.subgraphStack.length === 0) {
      state.diagnostics.push({
        code: "unexpected-end",
        severity: "warning",
        message: "`end` without a matching `subgraph`.",
        line: location.line,
        column: location.column,
        snippet: stmt,
      });
      return;
    }
    state.subgraphStack.pop();
    return;
  }
  if (kind === "direction") {
    return;
  }
  if (kind === "styling-ignored") {
    state.diagnostics.push({
      code: "styling-ignored",
      severity: "info",
      message: `Styling statement ignored: "${stmt}".`,
      line: location.line,
      column: location.column,
      snippet: stmt,
    });
    return;
  }
  if (kind === "interaction-ignored") {
    state.diagnostics.push({
      code: "interaction-ignored",
      severity: "warning",
      message: `Interaction statement ignored for safety: "${stmt}".`,
      line: location.line,
      column: location.column,
      snippet: stmt,
    });
    return;
  }

  handleEdgeStatement(state, stmt, location);
}

/**
 * Parses the supported Mermaid flowchart subset — header + direction, nodes with common
 * shapes, directed edges (solid/dotted/thick, labeled and chained), and nested subgraphs —
 * into a {@link ParsedFlowchart}. Comments and `%%{ … }%%` init directives are stripped
 * (directives are reported, never executed), and every unsupported or unsafe construct
 * yields a diagnostic anchored to its source location. The source text is only read, never
 * modified.
 */
export function parseFlowchart(text: string): ParsedFlowchart {
  const diagnostics: MermaidDiagnostic[] = [];
  const rawLines = text.split(/\r?\n/);

  let direction: Direction = DEFAULT_DIRECTION;
  let headerLine = -1;

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const trimmed = rawLines[idx].trim();
    if (trimmed.length === 0) continue;
    if (trimmed.includes("%%{")) {
      diagnostics.push({
        code: "directive-ignored",
        severity: "warning",
        message: "Mermaid init directive ignored for safety.",
        line: idx + 1,
        column: rawLines[idx].indexOf("%%{") + 1,
        snippet: trimmed,
      });
      continue;
    }
    if (trimmed.startsWith("%%")) continue;

    const header = HEADER_RE.exec(trimmed);
    if (!header) {
      diagnostics.push({
        code: "not-a-flowchart",
        severity: "error",
        message: `Expected a "flowchart" or "graph" header, found: "${trimmed}".`,
        line: idx + 1,
        column: rawLines[idx].indexOf(trimmed) + 1,
        snippet: trimmed,
      });
      return {
        direction,
        nodes: [],
        groups: [],
        edges: [],
        diagnostics,
        fatal: true,
      };
    }
    const dir = header[1]?.toUpperCase();
    if (dir && (DIRECTIONS as readonly string[]).includes(dir)) {
      direction = dir as Direction;
    }
    headerLine = idx;
    break;
  }

  if (headerLine === -1) {
    diagnostics.push({
      code: "empty-source",
      severity: "error",
      message: "Source contains no flowchart.",
      line: 1,
    });
    return {
      direction,
      nodes: [],
      groups: [],
      edges: [],
      diagnostics,
      fatal: true,
    };
  }

  const state: ParserState = {
    nodes: new Map(),
    groups: new Map(),
    edges: [],
    diagnostics,
    subgraphStack: [],
  };

  for (let idx = headerLine + 1; idx < rawLines.length; idx += 1) {
    const rawLine = rawLines[idx];
    const line = idx + 1;

    if (rawLine.includes("%%{")) {
      diagnostics.push({
        code: "directive-ignored",
        severity: "warning",
        message: "Mermaid init directive ignored for safety.",
        line,
        column: rawLine.indexOf("%%{") + 1,
        snippet: rawLine.trim(),
      });
      continue;
    }

    // Strip trailing `%%` comments (but never a `%%{` directive, handled above).
    const withoutComment = rawLine.replace(/\s*%%(?!\{).*$/, "");
    if (withoutComment.trim().length === 0) continue;

    let column = 1;
    for (const segment of withoutComment.split(";")) {
      const leading = segment.length - segment.trimStart().length;
      const stmt = segment.trim();
      if (stmt.length > 0) {
        handleStatement(state, stmt, { line, column: column + leading });
      }
      column += segment.length + 1;
    }
  }

  for (const openId of state.subgraphStack) {
    diagnostics.push({
      code: "unclosed-subgraph",
      severity: "warning",
      message: `Subgraph "${openId}" was never closed with \`end\`.`,
      line: rawLines.length,
    });
  }

  return {
    direction,
    nodes: [...state.nodes.values()].map((node) => ({
      id: node.id,
      label: node.label,
      shape: node.shape,
      ...(node.groupId !== undefined ? { groupId: node.groupId } : {}),
    })),
    groups: [...state.groups.values()].map((group) => ({
      id: group.id,
      label: group.label,
      memberIds: [...group.memberIds],
    })),
    edges: state.edges,
    diagnostics,
    fatal: false,
  };
}
