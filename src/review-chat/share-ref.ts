/**
 * A share id looks like `rev_` followed by 32 hex characters (see
 * {@link import("./share-store").shareIdFor}). This matches it wherever it appears — bare, inside
 * a share URL, or amid the rest of a mention — so a reviewer can paste a link or just the code.
 */
const SHARE_ID = /rev_[0-9a-f]{32}/;

/**
 * Extracts the first review share id from free text, or `null` when none is present. The bot
 * uses this to bind a thread to exactly one shared package: the id is the only thing that grants
 * access, so a mention without one is answered with guidance rather than a guessed package.
 */
export function parseShareRef(text: string): string | null {
  const match = SHARE_ID.exec(text);
  return match ? match[0] : null;
}
