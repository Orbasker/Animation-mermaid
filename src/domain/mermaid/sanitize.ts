const SCRIPTLIKE_BLOCK = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_TAG = /<[^>]*>/g;
const DANGEROUS_SCHEME = /\b(?:javascript|vbscript|data)\s*:/gi;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

export interface SanitizedLabel {
  /** The safe, plain-text label. */
  readonly value: string;
  /** True when sanitization stripped something dangerous (HTML tags or an active scheme). */
  readonly changed: boolean;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Turns raw label text taken from Mermaid syntax into safe, renderer-neutral plain text.
 * Surrounding quotes are unwrapped, HTML tags are removed (so `<script>`, `<img onerror>`
 * and friends cannot survive into a renderer), active URI schemes are neutralized, and
 * control characters are dropped. `changed` reports whether anything dangerous was removed
 * so the importer can raise a diagnostic; quote-unwrapping and whitespace collapsing alone
 * do not count as a dangerous change.
 */
export function sanitizeLabel(raw: string): SanitizedLabel {
  let text = raw;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1);
  }

  const dangerous =
    SCRIPTLIKE_BLOCK.test(text) ||
    HTML_TAG.test(text) ||
    DANGEROUS_SCHEME.test(text);
  SCRIPTLIKE_BLOCK.lastIndex = 0;
  HTML_TAG.lastIndex = 0;
  DANGEROUS_SCHEME.lastIndex = 0;

  const cleaned = collapse(
    text
      .replace(SCRIPTLIKE_BLOCK, "")
      .replace(HTML_TAG, "")
      .replace(DANGEROUS_SCHEME, "")
      .replace(CONTROL_CHARS, " "),
  );

  return { value: cleaned, changed: dangerous };
}
