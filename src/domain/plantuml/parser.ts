import type { ImportDiagnostic } from "@/domain/import/contract";
import { sanitizeLabel } from "@/domain/mermaid/sanitize";
import type {
  ParsedPlantuml,
  ParsedRelation,
  RelationKind,
  RelationLine,
} from "@/domain/plantuml/types";

/** The `@startuml` header that opens a PlantUML document (an optional name may follow). */
const START_RE = /^@startuml\b/i;
const END_RE = /^@enduml\b/i;

/**
 * Container keywords whose `{ … }` block nests its members into a drill-down container. Some
 * (`node`, `database`, `component`, …) also name a leaf element when written without a brace;
 * the brace is what makes them a container.
 */
const CONTAINER_KEYWORDS = new Set([
  "package",
  "namespace",
  "rectangle",
  "node",
  "folder",
  "frame",
  "cloud",
  "database",
  "component",
  "artifact",
  "storage",
  "agent",
  "together",
  "partition",
]);

/** Keywords that declare a single element (a box in the diagram). */
const ELEMENT_KEYWORDS = new Set([
  "class",
  "interface",
  "enum",
  "entity",
  "annotation",
  "object",
  "abstract",
  "actor",
  "participant",
  "usecase",
  "component",
  "node",
  "database",
  "boundary",
  "control",
  "collections",
  "queue",
  "card",
  "artifact",
  "storage",
  "agent",
  "circle",
  "state",
]);

/**
 * Class-like keywords whose `{ … }` block holds members (fields/methods), not nested elements.
 * The element is declared; the body is skipped rather than treated as a container.
 */
const CLASSLIKE_KEYWORDS = new Set([
  "class",
  "interface",
  "enum",
  "entity",
  "annotation",
  "object",
  "abstract",
  "state",
]);

/**
 * Statement keywords that carry no graph entity — preprocessor, styling, layout, and annotation
 * directives. Reported as diagnostics and skipped so the rest of the diagram still imports.
 */
const IGNORED_KEYWORDS = new Set([
  "skinparam",
  "skin",
  "title",
  "caption",
  "header",
  "footer",
  "legend",
  "endlegend",
  "note",
  "endnote",
  "hnote",
  "rnote",
  "scale",
  "hide",
  "show",
  "left",
  "right",
  "top",
  "bottom",
  "center",
  "autonumber",
  "activate",
  "deactivate",
  "destroy",
  "create",
  "return",
  "ref",
  "group",
  "alt",
  "else",
  "opt",
  "loop",
  "par",
  "break",
  "critical",
  "end",
  "newpage",
  "allow_mixing",
  "allowmixing",
  "mainframe",
  "sprite",
  "set",
]);

/** Characters a relation connector is built from. */
const CONNECTOR_CHARS = new Set("-.=~<>|*ox#{}+".split(""));

interface Location {
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
}

/** A stack frame for an open `{`: a named container, or a skipped class body / unknown block. */
type Frame =
  | { readonly kind: "container"; readonly id: string }
  | { readonly kind: "skip" };

interface ParserState {
  readonly elements: Map<
    string,
    { id: string; label: string; type?: string; groupId?: string }
  >;
  readonly containers: Map<
    string,
    { id: string; label: string; memberIds: string[] }
  >;
  readonly relations: ParsedRelation[];
  readonly diagnostics: ImportDiagnostic[];
  readonly frames: Frame[];
}

function firstToken(text: string): string {
  return text.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

/** The innermost open container, or undefined at top level. Skip frames are transparent. */
function currentContainer(state: ParserState): string | undefined {
  for (let i = state.frames.length - 1; i >= 0; i -= 1) {
    const frame = state.frames[i];
    if (frame.kind === "container") return frame.id;
  }
  return undefined;
}

/** True while any open block is a skipped body — its contents are ignored. */
function inSkip(state: ParserState): boolean {
  return state.frames.some((frame) => frame.kind === "skip");
}

/** Derives a stable, readable id from a display name for anonymous/quoted operands. */
function slug(name: string): string {
  const cleaned = sanitizeLabel(name).value;
  const id = cleaned.replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
  return id.length > 0 ? id : "node";
}

/** Records an element on first mention; a later explicit declaration fixes its type and label. */
function referenceElement(
  state: ParserState,
  ref: { id: string; label: string; type?: string },
): void {
  const existing = state.elements.get(ref.id);
  if (existing) {
    if (ref.type !== undefined && existing.type === undefined) {
      existing.type = ref.type;
    }
    if (existing.label === existing.id && ref.label !== ref.id) {
      existing.label = ref.label;
    }
    return;
  }
  const groupId = currentContainer(state);
  state.elements.set(ref.id, {
    id: ref.id,
    label: ref.label,
    ...(ref.type !== undefined ? { type: ref.type } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
  });
  if (groupId !== undefined) {
    const container = state.containers.get(groupId);
    if (container && !container.memberIds.includes(ref.id)) {
      container.memberIds.push(ref.id);
    }
  }
}

function pushSanitizeDiagnostic(
  state: ParserState,
  id: string,
  location: Location,
): void {
  state.diagnostics.push({
    code: "label-sanitized",
    severity: "warning",
    message: `Label for "${id}" contained unsafe markup that was removed.`,
    line: location.line,
    column: location.column,
    snippet: location.snippet,
  });
}

const AS_ALIAS_RE = /\s+as\s+([A-Za-z0-9_.$]+)\s*$/i;
const QUOTED_RE = /^"([^"]*)"/;
const IDENT_RE = /^[A-Za-z0-9_.$]+/;

/**
 * Parses the head of a declaration — everything after the keyword, minus a trailing `{` — into a
 * stable `{ id, label }`. Handles `"Display" as alias`, `Name as alias`, `"Display"`, and a bare
 * identifier; stereotypes (`<<…>>`), colors (`#…`), and links (`[[…]]`) are stripped first.
 */
function parseDeclarationHead(
  raw: string,
  state: ParserState,
  location: Location,
): { id: string; label: string } | null {
  let rest = raw
    .replace(/<<[^>]*>>/g, " ")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/#[0-9A-Za-z]+/g, " ")
    .trim();
  if (rest.length === 0) return null;

  const alias = AS_ALIAS_RE.exec(rest);
  let aliasId: string | undefined;
  if (alias) {
    aliasId = alias[1];
    rest = rest.slice(0, alias.index).trim();
  }

  const quoted = QUOTED_RE.exec(rest);
  if (quoted) {
    const { value, changed } = sanitizeLabel(quoted[1]);
    const label = value.length > 0 ? value : (aliasId ?? "element");
    const id = aliasId ?? slug(label);
    if (changed) pushSanitizeDiagnostic(state, id, location);
    return { id, label };
  }

  const bracket = /^\[([^\]]*)\]/.exec(rest);
  if (bracket) {
    const { value, changed } = sanitizeLabel(bracket[1]);
    const label = value.length > 0 ? value : (aliasId ?? "component");
    const id = aliasId ?? slug(label);
    if (changed) pushSanitizeDiagnostic(state, id, location);
    return { id, label };
  }

  const ident = IDENT_RE.exec(rest);
  if (ident) {
    const name = ident[0];
    return { id: aliasId ?? name, label: name };
  }

  // A multi-word bare name with no alias/quotes: derive a stable id from the sanitized text.
  const { value, changed } = sanitizeLabel(rest);
  if (changed) pushSanitizeDiagnostic(state, slug(value), location);
  const label = value.length > 0 ? value : "element";
  return { id: aliasId ?? slug(label), label };
}

interface Operand {
  readonly id: string;
  readonly label: string;
  readonly next: number;
}

/** Reads a relation operand at `text[i]`: a quoted name, a `[component]`, or a bare identifier. */
function readOperand(
  text: string,
  i: number,
  state: ParserState,
): Operand | null {
  let j = i;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  if (j >= text.length) return null;

  if (text[j] === '"') {
    const end = text.indexOf('"', j + 1);
    if (end === -1) return null;
    const inner = text.slice(j + 1, end);
    const { value } = sanitizeLabel(inner);
    const label = value.length > 0 ? value : "node";
    return { id: slug(label), label, next: end + 1 };
  }

  if (text[j] === "[") {
    const end = text.indexOf("]", j + 1);
    if (end === -1) return null;
    const inner = text.slice(j + 1, end).trim();
    if (inner.length === 0) return null;
    const { value } = sanitizeLabel(inner);
    const label = value.length > 0 ? value : "component";
    return {
      id: IDENT_RE.test(inner) ? inner : slug(label),
      label,
      next: end + 1,
    };
  }

  const ident = IDENT_RE.exec(text.slice(j));
  if (ident) {
    const id = ident[0];
    void state;
    return { id, label: id, next: j + id.length };
  }
  return null;
}

/** Reads a relation connector at `text[i]`; a valid connector holds at least one line char. */
function readConnector(
  text: string,
  i: number,
): { op: string; next: number } | null {
  let j = i;
  while (j < text.length && /\s/.test(text[j])) j += 1;
  const start = j;
  while (j < text.length && CONNECTOR_CHARS.has(text[j])) j += 1;
  const op = text.slice(start, j);
  if (op.length === 0 || !/[-.=~]/.test(op)) return null;
  return { op, next: j };
}

/** Classifies a connector into its {@link RelationLine} and {@link RelationKind}. */
function classifyConnector(op: string): {
  line: RelationLine;
  kind: RelationKind;
} {
  const line: RelationLine = op.includes(".") ? "dashed" : "solid";
  let kind: RelationKind = "association";
  if (op.includes("|")) kind = "extension";
  else if (op.includes("*")) kind = "composition";
  else if (op.includes("o")) kind = "aggregation";
  else if (line === "dashed") kind = "dependency";
  return { line, kind };
}

/** Strips PlantUML direction/length hints (`-up->`, `--down--`) from a connector run. */
function stripDirectionHints(stmt: string): string {
  return stmt.replace(
    /([-.=~])(?:up|down|left|right|hidden|norank)(?=[-.=~])/gi,
    "$1",
  );
}

/** Attempts to read a whole relation statement (`A --> B : label`); null if it is not one. */
function parseRelation(
  stmt: string,
  state: ParserState,
): ParsedRelation | null {
  const cleaned = stripDirectionHints(stmt);
  const left = readOperand(cleaned, 0, state);
  if (!left) return null;
  const connector = readConnector(cleaned, left.next);
  if (!connector) return null;
  const right = readOperand(cleaned, connector.next, state);
  if (!right) return null;

  let rest = cleaned.slice(right.next).trim();
  let label: string | undefined;
  if (rest.startsWith(":")) {
    const { value } = sanitizeLabel(rest.slice(1).trim());
    label = value.length > 0 ? value : undefined;
    rest = "";
  }
  // Anything left over that is not a label means this was not a clean relation.
  if (rest.replace(/<<[^>]*>>/g, "").trim().length > 0) return null;

  const { line, kind } = classifyConnector(connector.op);
  return {
    source: left.id,
    target: right.id,
    ...(label !== undefined ? { label } : {}),
    line,
    kind,
  };
}

function openContainer(
  state: ParserState,
  head: string,
  location: Location,
): void {
  const parsed = parseDeclarationHead(head, state, location);
  if (!parsed) {
    state.frames.push({ kind: "skip" });
    return;
  }
  const parentId = currentContainer(state);
  if (parentId !== undefined) {
    const parent = state.containers.get(parentId);
    if (parent && !parent.memberIds.includes(parsed.id)) {
      parent.memberIds.push(parsed.id);
    }
  }
  if (!state.containers.has(parsed.id)) {
    state.containers.set(parsed.id, {
      id: parsed.id,
      label: parsed.label,
      memberIds: [],
    });
  }
  state.frames.push({ kind: "container", id: parsed.id });
}

function handleStatement(
  state: ParserState,
  stmt: string,
  location: Location,
): void {
  // A closing brace pops the innermost open block.
  if (stmt === "}") {
    if (state.frames.length === 0) {
      state.diagnostics.push({
        code: "unexpected-close",
        severity: "warning",
        message: "`}` without a matching open block.",
        line: location.line,
        column: location.column,
        snippet: stmt,
      });
      return;
    }
    state.frames.pop();
    return;
  }

  // Inside a skipped body (class members / unknown block), only brace nesting matters.
  if (inSkip(state)) {
    if (stmt.endsWith("{")) state.frames.push({ kind: "skip" });
    return;
  }

  const kw = firstToken(stmt);

  if (IGNORED_KEYWORDS.has(kw)) {
    // A directive can still open a block (`note … {` is rare; `alt`/`loop` don't use braces).
    if (stmt.endsWith("{")) state.frames.push({ kind: "skip" });
    state.diagnostics.push({
      code: "directive-ignored",
      severity: "info",
      message: `PlantUML directive ignored: "${stmt}".`,
      line: location.line,
      column: location.column,
      snippet: stmt,
    });
    return;
  }
  if (kw.startsWith("!")) {
    state.diagnostics.push({
      code: "preprocessor-ignored",
      severity: "warning",
      message: `Preprocessor directive ignored for safety: "${stmt}".`,
      line: location.line,
      column: location.column,
      snippet: stmt,
    });
    return;
  }

  if (stmt.endsWith("{")) {
    const head = stmt.slice(0, -1).trim();
    const headKw = firstToken(head);
    if (CLASSLIKE_KEYWORDS.has(headKw)) {
      const rest = stripAbstractClass(head);
      declareKeywordElement(state, rest.keyword, rest.body, location);
      state.frames.push({ kind: "skip" });
      return;
    }
    if (CONTAINER_KEYWORDS.has(headKw) && head.length > headKw.length) {
      openContainer(state, head.slice(headKw.length), location);
      return;
    }
    // An unrecognized brace block (e.g. a class body with no keyword) is skipped wholesale.
    state.frames.push({ kind: "skip" });
    return;
  }

  if (ELEMENT_KEYWORDS.has(kw)) {
    const { keyword, body } = stripAbstractClass(stmt);
    // A keyword with a connector after it (`class A --> B`) is really a relation; fall through.
    if (parseRelation(body, state) === null) {
      declareKeywordElement(state, keyword, body, location);
      return;
    }
  }

  const relation = parseRelation(stmt, state);
  if (relation) {
    referenceElement(state, { id: relation.source, label: relation.source });
    referenceElement(state, { id: relation.target, label: relation.target });
    state.relations.push(relation);
    return;
  }

  // A lone element with no keyword: `[Component]`, `"Name" as n`, or `Ident`.
  if (stmt.startsWith("[") || stmt.startsWith('"')) {
    const parsed = parseDeclarationHead(stmt, state, location);
    if (parsed) {
      referenceElement(state, { id: parsed.id, label: parsed.label });
      return;
    }
  }

  state.diagnostics.push({
    code: "unrecognized-statement",
    severity: "warning",
    message: `Could not parse statement: "${stmt}".`,
    line: location.line,
    column: location.column,
    snippet: stmt,
  });
}

/** Normalizes `abstract class Foo` / `abstract Foo` to a `class` declaration. */
function stripAbstractClass(stmt: string): { keyword: string; body: string } {
  const tokens = stmt.split(/\s+/);
  if (tokens[0]?.toLowerCase() === "abstract") {
    const rest = tokens.slice(tokens[1]?.toLowerCase() === "class" ? 2 : 1);
    return { keyword: "class", body: rest.join(" ") };
  }
  const keyword = tokens[0]?.toLowerCase() ?? "";
  return { keyword, body: tokens.slice(1).join(" ") };
}

function declareKeywordElement(
  state: ParserState,
  keyword: string,
  body: string,
  location: Location,
): void {
  const parsed = parseDeclarationHead(body, state, location);
  if (!parsed) {
    state.diagnostics.push({
      code: "unrecognized-statement",
      severity: "warning",
      message: `Could not parse ${keyword} declaration: "${keyword} ${body}".`,
      line: location.line,
      column: location.column,
      snippet: `${keyword} ${body}`.trim(),
    });
    return;
  }
  referenceElement(state, {
    id: parsed.id,
    label: parsed.label,
    type: keyword,
  });
}

/**
 * Strips PlantUML comments from a raw source line: a full-line/trailing `'` single-line comment
 * and any inline `/' … '/` block-comment segments. Multi-line block comments are handled by the
 * caller's running `inBlockComment` flag. `"` strings shield a `'` inside a quoted label.
 */
function stripComments(
  line: string,
  inBlockComment: boolean,
): { text: string; inBlockComment: boolean } {
  let out = "";
  let inString = false;
  let block = inBlockComment;
  for (let i = 0; i < line.length; i += 1) {
    if (block) {
      if (line[i] === "'" && line[i + 1] === "/") {
        block = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += line[i];
      if (line[i] === '"') inString = false;
      continue;
    }
    if (line[i] === '"') {
      inString = true;
      out += line[i];
      continue;
    }
    if (line[i] === "/" && line[i + 1] === "'") {
      block = true;
      i += 1;
      continue;
    }
    if (line[i] === "'") {
      // A single-quote comment runs to end of line.
      break;
    }
    out += line[i];
  }
  return { text: out, inBlockComment: block };
}

/**
 * Parses the supported PlantUML subset — a `@startuml … @enduml` document containing element
 * declarations (`class`/`component`/`actor`/`participant`/…), directed relations (association,
 * dependency, extension, composition, aggregation, with optional labels), and
 * `package`/`namespace`/`rectangle`/`node`/… containers that nest into drill-down groups — into
 * a {@link ParsedPlantuml}. Class bodies (members) are skipped, comments (`'`, `/' … '/`) are
 * stripped, and every unsupported or unsafe construct becomes a diagnostic rather than a thrown
 * error. A fatal diagnostic (missing `@startuml` / empty source) yields no model.
 */
export function parsePlantuml(text: string): ParsedPlantuml {
  const diagnostics: ImportDiagnostic[] = [];
  const rawLines = text.split(/\r?\n/);

  let startLine = -1;
  let inBlockComment = false;
  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const stripped = stripComments(rawLines[idx], inBlockComment);
    inBlockComment = stripped.inBlockComment;
    const trimmed = stripped.text.trim();
    if (trimmed.length === 0) continue;
    if (!START_RE.test(trimmed)) {
      diagnostics.push({
        code: "not-plantuml",
        severity: "error",
        message: `Expected a "@startuml" header, found: "${trimmed}".`,
        line: idx + 1,
        column: rawLines[idx].indexOf(trimmed) + 1,
        snippet: trimmed,
      });
      return {
        elements: [],
        containers: [],
        relations: [],
        diagnostics,
        fatal: true,
      };
    }
    startLine = idx;
    break;
  }

  if (startLine === -1) {
    diagnostics.push({
      code: "empty-source",
      severity: "error",
      message: "Source contains no PlantUML diagram.",
      line: 1,
    });
    return {
      elements: [],
      containers: [],
      relations: [],
      diagnostics,
      fatal: true,
    };
  }

  const state: ParserState = {
    elements: new Map(),
    containers: new Map(),
    relations: [],
    diagnostics,
    frames: [],
  };

  let ended = false;
  for (let idx = startLine + 1; idx < rawLines.length; idx += 1) {
    const stripped = stripComments(rawLines[idx], inBlockComment);
    inBlockComment = stripped.inBlockComment;
    const line = idx + 1;
    const withoutComment = stripped.text;
    if (withoutComment.trim().length === 0) continue;

    if (END_RE.test(withoutComment.trim())) {
      ended = true;
      break;
    }

    const leading = withoutComment.length - withoutComment.trimStart().length;
    const stmt = withoutComment.trim();
    handleStatement(state, stmt, {
      line,
      column: 1 + leading,
      snippet: stmt,
    });
  }

  for (const frame of state.frames) {
    if (frame.kind === "container") {
      diagnostics.push({
        code: "unclosed-container",
        severity: "warning",
        message: `Container "${frame.id}" was never closed with \`}\`.`,
        line: rawLines.length,
      });
    }
  }
  if (!ended) {
    diagnostics.push({
      code: "unterminated-uml",
      severity: "info",
      message: "Source has no `@enduml`; parsed to the end.",
      line: rawLines.length,
    });
  }

  return {
    elements: [...state.elements.values()].map((element) => ({
      id: element.id,
      label: element.label,
      ...(element.type !== undefined ? { type: element.type } : {}),
      ...(element.groupId !== undefined ? { groupId: element.groupId } : {}),
    })),
    containers: [...state.containers.values()].map((container) => ({
      id: container.id,
      label: container.label,
      memberIds: [...container.memberIds],
    })),
    relations: state.relations,
    diagnostics,
    fatal: false,
  };
}
