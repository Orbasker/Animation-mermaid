/**
 * Returns the first significant line of diagram source — the header — skipping blank lines,
 * `%%` comments, and `%%{ … }%%` init directives. Importers use it for cheap, side-effect-free
 * grammar detection without parsing the whole document. Returns `undefined` when the source has
 * no significant line.
 */
export function firstSignificantLine(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.includes("%%{")) continue;
    if (trimmed.startsWith("%%")) continue;
    return trimmed;
  }
  return undefined;
}
