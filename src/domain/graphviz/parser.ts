import { sanitizeLabel } from "@/domain/mermaid/sanitize";
import {
  DEFAULT_GRAPHVIZ_DIRECTION,
  GRAPHVIZ_DIRECTIONS,
  type GraphvizDiagnostic,
  type GraphvizDiagnosticCode,
  type GraphvizDirection,
} from "@/domain/graphviz/types";

/** A node discovered in the source, keyed by its DOT id (the semantic key). */
export interface ParsedNode {
  readonly id: string;
  readonly label: string;
  /** Innermost `cluster*` subgraph the node was first mentioned in, if any. */
  readonly groupId?: string;
  /** Renderer-neutral shape carried from a `shape=` attribute, when present. */
  readonly shape?: string;
}

/** A directed edge between two DOT node ids. */
export interface ParsedEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  /** `"dotted"`/`"thick"` when a `style=` attribute maps to one; `"solid"` otherwise. */
  readonly line: "solid" | "dotted" | "thick";
}

/**
 * A `cluster*` subgraph and its direct members (nodes and nested clusters), in mention order.
 * Non-cluster subgraphs are transparent — they never become groups — so this list holds only
 * the containers a user can drill into.
 */
export interface ParsedGroup {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly string[];
}

/** The structural result of parsing DOT, plus every diagnostic gathered. */
export interface ParsedGraphviz {
  readonly directed: boolean;
  readonly direction: GraphvizDirection;
  readonly nodes: readonly ParsedNode[];
  readonly groups: readonly ParsedGroup[];
  readonly edges: readonly ParsedEdge[];
  readonly diagnostics: readonly GraphvizDiagnostic[];
  /** Set when a fatal diagnostic (bad header / empty source) prevented parsing. */
  readonly fatal: boolean;
}

type TokenType =
  | "id"
  | "html"
  | "{"
  | "}"
  | "["
  | "]"
  | "="
  | ";"
  | ","
  | ":"
  | "+"
  | "edgeop";

interface Token {
  readonly type: TokenType;
  /** For `id`/`html`/`edgeop`, the literal text (quotes stripped, whitespace preserved). */
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

/** Characters that continue a DOT identifier or numeral (alphanumerics, `_`, `.`, and 8-bit+). */
const ID_CHAR = /[A-Za-z0-9_.\u0080-\uffff]/;

const PUNCT: Readonly<Record<string, TokenType>> = {
  "{": "{",
  "}": "}",
  "[": "[",
  "]": "]",
  "=": "=",
  ";": ";",
  ",": ",",
  ":": ":",
  "+": "+",
};

/**
 * Tokenizes DOT source into the small set of tokens the parser consumes, skipping whitespace and
 * every comment form (`//`, block comments, and `#` preprocessor lines). Quoted strings are
 * unwrapped (with `\"` and line-continuation handling) and HTML-like `<…>` strings are captured
 * whole so the parser can flag them. Lexing never throws; an unterminated string simply runs to
 * end-of-input.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const advance = (n = 1): void => {
    for (let k = 0; k < n; k += 1) {
      if (text[i] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      i += 1;
    }
  };

  while (i < text.length) {
    const c = text[i];

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      advance();
      continue;
    }
    if (c === "#" || (c === "/" && text[i + 1] === "/")) {
      while (i < text.length && text[i] !== "\n") advance();
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      advance(2);
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        advance();
      }
      advance(2);
      continue;
    }

    const startLine = line;
    const startColumn = column;

    if (c in PUNCT) {
      tokens.push({
        type: PUNCT[c],
        value: c,
        line: startLine,
        column: startColumn,
      });
      advance();
      continue;
    }

    if (c === "-" && (text[i + 1] === ">" || text[i + 1] === "-")) {
      tokens.push({
        type: "edgeop",
        value: text.slice(i, i + 2),
        line: startLine,
        column: startColumn,
      });
      advance(2);
      continue;
    }

    if (c === '"') {
      advance();
      let value = "";
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          const nxt = text[i + 1];
          if (nxt === '"') {
            value += '"';
            advance(2);
            continue;
          }
          if (nxt === "\n") {
            advance(2);
            continue;
          }
        }
        value += text[i];
        advance();
      }
      advance(); // closing quote (no-op at EOF)
      tokens.push({ type: "id", value, line: startLine, column: startColumn });
      continue;
    }

    if (c === "<") {
      let depth = 0;
      let value = "";
      while (i < text.length) {
        if (text[i] === "<") depth += 1;
        else if (text[i] === ">") depth -= 1;
        value += text[i];
        advance();
        if (depth === 0) break;
      }
      tokens.push({
        type: "html",
        value,
        line: startLine,
        column: startColumn,
      });
      continue;
    }

    if (ID_CHAR.test(c)) {
      let value = "";
      while (i < text.length && ID_CHAR.test(text[i])) {
        value += text[i];
        advance();
      }
      tokens.push({ type: "id", value, line: startLine, column: startColumn });
      continue;
    }

    // Anything else is a stray character; skip it so lexing always makes progress.
    advance();
  }

  return tokens;
}

function isKeyword(token: Token, word: string): boolean {
  return token.type === "id" && token.value.toLowerCase() === word;
}

interface ParserState {
  readonly nodes: Map<
    string,
    { id: string; label: string; groupId?: string; shape?: string }
  >;
  readonly groups: Map<
    string,
    { id: string; label: string; memberIds: string[] }
  >;
  readonly edges: ParsedEdge[];
  readonly diagnostics: GraphvizDiagnostic[];
  /** Stack of open `cluster*` ids (innermost last); non-cluster subgraphs are not pushed. */
  readonly clusterStack: string[];
  readonly directed: boolean;
  direction: GraphvizDirection;
}

function currentCluster(state: ParserState): string | undefined {
  return state.clusterStack[state.clusterStack.length - 1];
}

/** A DOT subgraph is a drawable container iff its id begins with `cluster`. */
function isClusterId(id: string): boolean {
  return id.toLowerCase().startsWith("cluster");
}

function styleToLine(style: string): "solid" | "dotted" | "thick" {
  const lowered = style.toLowerCase();
  if (lowered.includes("dashed") || lowered.includes("dotted")) return "dotted";
  if (lowered.includes("bold")) return "thick";
  return "solid";
}

/** Records a node reference, creating it (and its cluster membership) on first mention. */
function referenceNode(state: ParserState, id: string): void {
  if (state.nodes.has(id)) return;
  const cluster = currentCluster(state);
  state.nodes.set(id, {
    id,
    label: id,
    ...(cluster !== undefined ? { groupId: cluster } : {}),
  });
  if (cluster !== undefined) {
    state.groups.get(cluster)?.memberIds.push(id);
  }
}

/** Applies a parsed attribute map to a node, refining its label and shape. */
function applyNodeAttributes(
  state: ParserState,
  id: string,
  attrs: Map<string, string>,
  location: { line: number; column: number; snippet: string },
): void {
  const node = state.nodes.get(id);
  if (!node) return;

  const rawLabel = attrs.get("label");
  if (rawLabel !== undefined) {
    const { value, changed } = sanitizeLabel(rawLabel);
    if (changed) {
      state.diagnostics.push({
        code: "label-sanitized",
        severity: "warning",
        message: `Label for node "${id}" contained unsafe markup that was removed.`,
        line: location.line,
        column: location.column,
        snippet: location.snippet,
      });
    }
    if (value.length > 0) node.label = value;
  }

  const shape = attrs.get("shape");
  if (shape !== undefined && shape.length > 0) {
    node.shape = shape.toLowerCase();
  }
}

/**
 * Captures graph-level attributes that affect the normalized model: `rankdir` (layout direction)
 * and, when set inside a cluster, `label` (the container's title).
 */
function captureGraphAttrs(
  state: ParserState,
  attrs: Map<string, string>,
): void {
  const rankdir = attrs.get("rankdir");
  if (rankdir !== undefined) {
    const upper = rankdir.toUpperCase();
    if ((GRAPHVIZ_DIRECTIONS as readonly string[]).includes(upper)) {
      state.direction = upper as GraphvizDirection;
    }
  }

  const cluster = currentCluster(state);
  const rawLabel = attrs.get("label");
  if (cluster !== undefined && rawLabel !== undefined) {
    const { value } = sanitizeLabel(rawLabel);
    const group = state.groups.get(cluster);
    if (group && value.length > 0) group.label = value;
  }
}

/** A cursor over the token stream, used by the recursive-descent body reader. */
class TokenCursor {
  private pos = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }
}

/** Parses a bracketed attribute list (`[a=b, c=d][e=f]`), returning the merged name→value map. */
function parseAttrList(cursor: TokenCursor): Map<string, string> {
  const attrs = new Map<string, string>();
  while (cursor.peek()?.type === "[") {
    cursor.next(); // "["
    while (cursor.peek() && cursor.peek()!.type !== "]") {
      const nameToken = cursor.peek()!;
      if (nameToken.type !== "id" && nameToken.type !== "html") {
        cursor.next(); // separator or stray token
        continue;
      }
      cursor.next(); // name
      if (cursor.peek()?.type === "=") {
        cursor.next(); // "="
        const valueToken = cursor.peek();
        if (
          valueToken &&
          (valueToken.type === "id" || valueToken.type === "html")
        ) {
          cursor.next();
          attrs.set(nameToken.value.toLowerCase(), valueToken.value);
        }
      }
    }
    cursor.next(); // "]"
  }
  return attrs;
}

/** Reads an edge/node endpoint id, dropping any `:port:compass` suffix. Null for a subgraph endpoint. */
function readEndpointId(
  cursor: TokenCursor,
  state: ParserState,
): string | null {
  const token = cursor.peek();
  if (!token || token.type !== "id") return null;
  cursor.next();
  const id = token.value;
  while (cursor.peek()?.type === ":") {
    cursor.next(); // ":"
    if (cursor.peek()?.type === "id") cursor.next(); // port / compass
    state.diagnostics.push({
      code: "port-ignored",
      severity: "info",
      message: `Port on node "${id}" ignored; the edge connects to the node.`,
      line: token.line,
      column: token.column,
    });
  }
  return id;
}

/**
 * Parses the body of a `{ … }` block: node, edge, attribute, and nested-subgraph statements.
 * Consumes the closing `}` (reporting `unclosed-brace` at end-of-input).
 */
function parseBody(
  cursor: TokenCursor,
  state: ParserState,
  depth: number,
): void {
  while (!cursor.atEnd()) {
    const token = cursor.peek()!;

    if (token.type === "}") {
      cursor.next();
      return;
    }
    if (token.type === ";" || token.type === ",") {
      cursor.next();
      continue;
    }

    if (token.type === "{" || isKeyword(token, "subgraph")) {
      parseSubgraph(cursor, state, depth);
      continue;
    }

    if (
      isKeyword(token, "node") ||
      isKeyword(token, "edge") ||
      isKeyword(token, "graph")
    ) {
      cursor.next();
      const attrs = parseAttrList(cursor);
      if (isKeyword(token, "graph")) {
        captureGraphAttrs(state, attrs);
      } else if (attrs.size > 0) {
        state.diagnostics.push({
          code: "default-attributes-ignored",
          severity: "info",
          message: `Default \`${token.value.toLowerCase()}\` attributes are not applied to existing entities.`,
          line: token.line,
          column: token.column,
        });
      }
      continue;
    }

    if (token.type === "id") {
      parseStatementFromId(cursor, state);
      continue;
    }

    if (token.type === "html") {
      state.diagnostics.push({
        code: "unsupported-html-id",
        severity: "warning",
        message: "HTML-like id/record is not supported and was skipped.",
        line: token.line,
        column: token.column,
        snippet: token.value.slice(0, 40),
      });
      cursor.next();
      parseAttrList(cursor);
      continue;
    }

    if (token.type === "]") {
      state.diagnostics.push({
        code: "unexpected-close",
        severity: "warning",
        message: "Unexpected `]` outside an attribute list.",
        line: token.line,
        column: token.column,
      });
    }
    cursor.next();
  }

  state.diagnostics.push({
    code: "unclosed-brace",
    severity: "warning",
    message: "A `{` was never closed with a matching `}`.",
    line: 1,
  });
}

/** Parses a `subgraph [id] { … }` (or anonymous `{ … }`), tracking `cluster*` containers. */
function parseSubgraph(
  cursor: TokenCursor,
  state: ParserState,
  depth: number,
): void {
  let id: string | undefined;

  if (isKeyword(cursor.peek()!, "subgraph")) {
    cursor.next(); // "subgraph"
    const idToken = cursor.peek();
    if (idToken && idToken.type === "id") {
      cursor.next();
      id = idToken.value;
    }
  }

  if (cursor.peek()?.type !== "{") {
    // A bare `subgraph id;` reference without a body — nothing to nest.
    return;
  }
  cursor.next(); // "{"

  const isCluster = id !== undefined && isClusterId(id);
  if (isCluster && id !== undefined) {
    const parent = currentCluster(state);
    if (
      parent !== undefined &&
      !state.groups.get(parent)?.memberIds.includes(id)
    ) {
      state.groups.get(parent)?.memberIds.push(id);
    }
    if (!state.groups.has(id)) {
      state.groups.set(id, { id, label: id, memberIds: [] });
    }
    state.clusterStack.push(id);
  }

  parseBody(cursor, state, depth + 1);

  if (isCluster) state.clusterStack.pop();
}

/**
 * Parses a statement that begins with an id: a graph-level attribute (`rankdir=LR`), an edge chain
 * (`a -> b -> c [attrs]`), or a node statement (`a [attrs]`).
 */
function parseStatementFromId(cursor: TokenCursor, state: ParserState): void {
  const first = cursor.peek()!;

  // Graph-level attribute assignment: `name = value`.
  if (cursor.peek(1)?.type === "=") {
    cursor.next(); // name
    cursor.next(); // "="
    const valueToken = cursor.peek();
    if (
      valueToken &&
      (valueToken.type === "id" || valueToken.type === "html")
    ) {
      cursor.next();
      captureGraphAttrs(
        state,
        new Map([[first.value.toLowerCase(), valueToken.value]]),
      );
    }
    return;
  }

  const firstId = readEndpointId(cursor, state);
  if (firstId === null) {
    state.diagnostics.push({
      code: "unrecognized-statement",
      severity: "warning",
      message: `Could not parse statement starting at "${first.value}".`,
      line: first.line,
      column: first.column,
      snippet: first.value,
    });
    cursor.next();
    return;
  }

  if (cursor.peek()?.type === "edgeop") {
    parseEdgeChain(cursor, state, firstId, first);
    return;
  }

  if (firstId.length === 0) {
    state.diagnostics.push({
      code: "empty-node-id",
      severity: "warning",
      message: "Node statement has an empty id.",
      line: first.line,
      column: first.column,
    });
    return;
  }
  referenceNode(state, firstId);
  const attrs = parseAttrList(cursor);
  applyNodeAttributes(state, firstId, attrs, {
    line: first.line,
    column: first.column,
    snippet: first.value,
  });
}

/** Parses `a -> b -> c [attrs]`, emitting one edge per consecutive pair with the shared attrs. */
function parseEdgeChain(
  cursor: TokenCursor,
  state: ParserState,
  firstId: string,
  first: Token,
): void {
  const ids: string[] = [firstId];
  let sawSubgraphEndpoint = false;

  while (cursor.peek()?.type === "edgeop") {
    cursor.next(); // edgeop
    const nextToken = cursor.peek();
    if (
      nextToken &&
      (nextToken.type === "{" || isKeyword(nextToken, "subgraph"))
    ) {
      sawSubgraphEndpoint = true;
      parseSubgraph(cursor, state, 1);
      break;
    }
    const nextId = readEndpointId(cursor, state);
    if (nextId === null) break;
    ids.push(nextId);
  }

  if (sawSubgraphEndpoint) {
    state.diagnostics.push({
      code: "unsupported-endpoint",
      severity: "warning",
      message:
        "Edges to or from a subgraph are not supported; the edge was skipped.",
      line: first.line,
      column: first.column,
    });
  }

  const attrs = parseAttrList(cursor);
  const rawLabel = attrs.get("label");
  const label =
    rawLabel !== undefined ? sanitizeLabel(rawLabel).value : undefined;
  const line = styleToLine(attrs.get("style") ?? "");

  for (const id of ids) referenceNode(state, id);

  for (let k = 0; k + 1 < ids.length; k += 1) {
    state.edges.push({
      source: ids[k],
      target: ids[k + 1],
      ...(label ? { label } : {}),
      line,
    });
  }
}

/**
 * Parses the supported Graphviz DOT subset — a `strict? (di)graph id? { … }` wrapper, node and
 * chained-edge statements with attribute lists, `rankdir`, and `subgraph cluster_* { … }` nested
 * containers — into a {@link ParsedGraphviz}. Comments are stripped, labels are sanitized, and
 * every unsupported or unsafe construct yields a diagnostic anchored to its source location. The
 * source text is only read, never modified.
 */
export function parseGraphviz(text: string): ParsedGraphviz {
  const diagnostics: GraphvizDiagnostic[] = [];

  if (text.trim().length === 0) {
    return fatal(diagnostics, "empty-source", "Source is empty.", true);
  }

  const tokens = tokenize(text);
  const cursor = new TokenCursor(tokens);

  let header = cursor.peek();
  if (header && isKeyword(header, "strict")) {
    cursor.next();
    header = cursor.peek();
  }
  if (
    !header ||
    (!isKeyword(header, "graph") && !isKeyword(header, "digraph"))
  ) {
    return fatal(
      diagnostics,
      "not-a-graphviz",
      `Expected a "graph" or "digraph" header, found "${header?.value ?? "end of input"}".`,
      true,
      header,
    );
  }
  const directed = isKeyword(header, "digraph");
  cursor.next(); // graph / digraph

  if (cursor.peek()?.type === "id") cursor.next(); // optional graph id

  if (cursor.peek()?.type !== "{") {
    return fatal(
      diagnostics,
      "not-a-graphviz",
      "Expected `{` to open the graph body.",
      true,
      cursor.peek(),
      directed,
    );
  }
  cursor.next(); // "{"

  const state: ParserState = {
    nodes: new Map(),
    groups: new Map(),
    edges: [],
    diagnostics,
    clusterStack: [],
    directed,
    direction: DEFAULT_GRAPHVIZ_DIRECTION,
  };

  parseBody(cursor, state, 1);

  return {
    directed: state.directed,
    direction: state.direction,
    nodes: [...state.nodes.values()].map((node) => ({
      id: node.id,
      label: node.label,
      ...(node.groupId !== undefined ? { groupId: node.groupId } : {}),
      ...(node.shape !== undefined ? { shape: node.shape } : {}),
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

function fatal(
  diagnostics: GraphvizDiagnostic[],
  code: GraphvizDiagnosticCode,
  message: string,
  isFatal: boolean,
  at?: Token,
  directed = true,
): ParsedGraphviz {
  diagnostics.push({
    code,
    severity: "error",
    message,
    line: at?.line ?? 1,
    ...(at?.column !== undefined ? { column: at.column } : {}),
    ...(at?.value ? { snippet: at.value } : {}),
  });
  return {
    directed,
    direction: DEFAULT_GRAPHVIZ_DIRECTION,
    nodes: [],
    groups: [],
    edges: [],
    diagnostics,
    fatal: isFatal,
  };
}

/**
 * Derives the stable semantic key for an edge, matching the flowchart/sequence importers: the
 * base is `source->target`, with identical pairs disambiguated by `~2`, `~3`, … in source order so
 * re-importing unchanged source always reproduces the same keys.
 */
export function graphvizEdgeKey(
  edge: ParsedEdge,
  seen: Map<string, number>,
): string {
  const base = `${edge.source}->${edge.target}`;
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}~${count}`;
}
