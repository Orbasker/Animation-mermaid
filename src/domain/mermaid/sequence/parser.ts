import type { ImportDiagnostic } from "@/domain/import/contract";
import { sanitizeLabel } from "@/domain/mermaid/sanitize";
import type { EdgeArrow, EdgeLineStyle } from "@/domain/mermaid/types";
import type {
  ParsedMessage,
  ParsedParticipant,
  ParsedSequence,
  ParticipantRole,
} from "@/domain/mermaid/sequence/types";

const HEADER_RE = /^sequenceDiagram\b/;
const PARTICIPANT_RE = /^(participant|actor)\s+(.+)$/;
const PARTICIPANT_ALIAS_RE = /^([A-Za-z0-9_]+)\s+as\s+(.+)$/;
const IDENT_RE = /^[A-Za-z0-9_]+$/;

/**
 * Message connectors Mermaid sequence diagrams understand, longest first so `-->>` is matched
 * before `-->`. Each maps to a renderer-neutral {@link EdgeLineStyle}/{@link EdgeArrow}: a
 * doubled dash (`--`) is a dotted lifeline reply, `>>`/`>` are arrowheads, `x` a lost message,
 * and `)` an async (open) arrow.
 */
const CONNECTORS: readonly {
  readonly op: string;
  readonly line: EdgeLineStyle;
  readonly arrow: EdgeArrow;
}[] = [
  { op: "-->>", line: "dotted", arrow: "normal" },
  { op: "--x", line: "dotted", arrow: "cross" },
  { op: "--)", line: "dotted", arrow: "circle" },
  { op: "-->", line: "dotted", arrow: "open" },
  { op: "->>", line: "solid", arrow: "normal" },
  { op: "-x", line: "solid", arrow: "cross" },
  { op: "-)", line: "solid", arrow: "circle" },
  { op: "->", line: "solid", arrow: "open" },
];

/** Control-flow blocks whose header opens a frame; their inner messages still import. */
const BLOCK_OPENERS = new Set([
  "loop",
  "alt",
  "opt",
  "par",
  "critical",
  "break",
  "rect",
  "box",
]);
/** Block continuations (`else`, `and`, `option`) and closers (`end`) that carry no message. */
const BLOCK_CONTINUATIONS = new Set(["else", "and", "option", "end"]);

interface ParserState {
  readonly participants: Map<string, ParsedParticipant>;
  readonly messages: ParsedMessage[];
  readonly diagnostics: ImportDiagnostic[];
}

/** Records a participant on first mention; an explicit declaration fixes its role and label. */
function referenceParticipant(
  state: ParserState,
  id: string,
  label: string,
  role: ParticipantRole,
): void {
  const existing = state.participants.get(id);
  if (!existing) {
    state.participants.set(id, { id, label, role });
    return;
  }
  if (role === "actor" && existing.role !== "actor") {
    state.participants.set(id, { ...existing, role });
  }
}

function pushSanitizeDiagnostic(
  state: ParserState,
  id: string,
  line: number,
  snippet: string,
): void {
  state.diagnostics.push({
    code: "label-sanitized",
    severity: "warning",
    message: `Label for participant "${id}" contained unsafe markup that was removed.`,
    line,
    snippet,
  });
}

/**
 * Splits a message statement into source, connector, target, and label, or null if it is not a
 * message. The label (everything after the first `:`) is separated first so an arrow-like token
 * inside the label is never mistaken for the connector; activation markers (`+`/`-`) between the
 * connector and the target are stripped.
 */
function readMessage(stmt: string): {
  readonly source: string;
  readonly target: string;
  readonly line: EdgeLineStyle;
  readonly arrow: EdgeArrow;
  readonly rawLabel?: string;
} | null {
  const colon = stmt.indexOf(":");
  const head = colon === -1 ? stmt : stmt.slice(0, colon);
  const rawLabel = colon === -1 ? undefined : stmt.slice(colon + 1).trim();

  for (const { op, line, arrow } of CONNECTORS) {
    const index = head.indexOf(op);
    if (index <= 0) continue;
    const left = head.slice(0, index).trim();
    const target = head
      .slice(index + op.length)
      .replace(/^[+-]\s*/, "")
      .trim();
    if (!IDENT_RE.test(left) || !IDENT_RE.test(target)) return null;
    return {
      source: left,
      target,
      line,
      arrow,
      ...(rawLabel ? { rawLabel } : {}),
    };
  }
  return null;
}

function handleParticipantDeclaration(
  state: ParserState,
  role: ParticipantRole,
  rest: string,
  line: number,
  snippet: string,
): void {
  const alias = PARTICIPANT_ALIAS_RE.exec(rest);
  if (alias) {
    const id = alias[1];
    const { value, changed } = sanitizeLabel(alias[2]);
    if (changed) pushSanitizeDiagnostic(state, id, line, snippet);
    referenceParticipant(state, id, value || id, role);
    return;
  }
  if (IDENT_RE.test(rest.trim())) {
    const id = rest.trim();
    referenceParticipant(state, id, id, role);
    return;
  }
  // A quoted or multi-word name with no alias: derive a stable id from the sanitized label.
  const { value, changed } = sanitizeLabel(rest);
  if (changed) pushSanitizeDiagnostic(state, value || rest, line, snippet);
  const label = value || "participant";
  const id =
    label.replace(/[^A-Za-z0-9_]+/g, "-").replace(/^-+|-+$/g, "") ||
    "participant";
  referenceParticipant(state, id, label, role);
}

function handleStatement(state: ParserState, stmt: string, line: number): void {
  const first = stmt.split(/\s+/, 1)[0]?.toLowerCase() ?? "";

  const participant = PARTICIPANT_RE.exec(stmt);
  if (participant) {
    handleParticipantDeclaration(
      state,
      participant[1] as ParticipantRole,
      participant[2].trim(),
      line,
      stmt,
    );
    return;
  }

  if (first === "autonumber") {
    state.diagnostics.push({
      code: "autonumber-ignored",
      severity: "info",
      message: "`autonumber` is ignored; messages keep their source order.",
      line,
      snippet: stmt,
    });
    return;
  }
  if (first === "activate" || first === "deactivate") {
    state.diagnostics.push({
      code: "activation-ignored",
      severity: "info",
      message: `Lifeline ${first} is ignored; participants and messages still import.`,
      line,
      snippet: stmt,
    });
    return;
  }
  if (first === "note") {
    state.diagnostics.push({
      code: "note-ignored",
      severity: "info",
      message: "Notes are not imported as graph entities.",
      line,
      snippet: stmt,
    });
    return;
  }
  if (BLOCK_CONTINUATIONS.has(first)) return;
  if (BLOCK_OPENERS.has(first)) {
    state.diagnostics.push({
      code: "block-ignored",
      severity: "info",
      message: `Control block "${first}" is flattened; its messages still import.`,
      line,
      snippet: stmt,
    });
    return;
  }
  if (first === "link" || first === "links" || first === "properties") {
    state.diagnostics.push({
      code: "unrecognized-statement",
      severity: "info",
      message: `Participant metadata statement ignored: "${stmt}".`,
      line,
      snippet: stmt,
    });
    return;
  }

  const message = readMessage(stmt);
  if (!message) {
    state.diagnostics.push({
      code: "unrecognized-statement",
      severity: "warning",
      message: `Could not parse statement: "${stmt}".`,
      line,
      snippet: stmt,
    });
    return;
  }

  referenceParticipant(state, message.source, message.source, "participant");
  referenceParticipant(state, message.target, message.target, "participant");

  let label: string | undefined;
  if (message.rawLabel) {
    const { value, changed } = sanitizeLabel(message.rawLabel);
    if (changed) {
      state.diagnostics.push({
        code: "label-sanitized",
        severity: "warning",
        message: "Message label contained unsafe markup that was removed.",
        line,
        snippet: stmt,
      });
    }
    label = value || undefined;
  }

  state.messages.push({
    source: message.source,
    target: message.target,
    ...(label ? { label } : {}),
    line: message.line,
    arrow: message.arrow,
  });
}

/**
 * Parses the supported Mermaid sequence-diagram subset — the `sequenceDiagram` header,
 * `participant`/`actor` declarations (with `as` aliases), and directed messages (sync/async,
 * solid/dotted, labeled) — into a {@link ParsedSequence}. Participants are created on first
 * mention so implicit ones still import; control blocks (`loop`, `alt`, …), notes, activations
 * and `autonumber` are reported as diagnostics but never abort the import, and their inner
 * messages are kept. Comments and `%%{ … }%%` init directives are stripped (directives are
 * reported, never executed). The source text is only read, never modified.
 */
export function parseSequence(text: string): ParsedSequence {
  const diagnostics: ImportDiagnostic[] = [];
  const rawLines = text.split(/\r?\n/);

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

    if (!HEADER_RE.test(trimmed)) {
      diagnostics.push({
        code: "not-a-sequence",
        severity: "error",
        message: `Expected a "sequenceDiagram" header, found: "${trimmed}".`,
        line: idx + 1,
        column: rawLines[idx].indexOf(trimmed) + 1,
        snippet: trimmed,
      });
      return { participants: [], messages: [], diagnostics, fatal: true };
    }
    headerLine = idx;
    break;
  }

  if (headerLine === -1) {
    diagnostics.push({
      code: "empty-source",
      severity: "error",
      message: "Source contains no sequence diagram.",
      line: 1,
    });
    return { participants: [], messages: [], diagnostics, fatal: true };
  }

  const state: ParserState = {
    participants: new Map(),
    messages: [],
    diagnostics,
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

    const withoutComment = rawLine.replace(/\s*%%(?!\{).*$/, "");
    if (withoutComment.trim().length === 0) continue;

    for (const segment of withoutComment.split(";")) {
      const stmt = segment.trim();
      if (stmt.length > 0) handleStatement(state, stmt, line);
    }
  }

  return {
    participants: [...state.participants.values()],
    messages: state.messages,
    diagnostics,
    fatal: false,
  };
}
