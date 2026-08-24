import type { EntityId } from "@/domain/graph";

/**
 * A single asserted correspondence between an entity in the base snapshot and one in the
 * target snapshot. Pairs are directional (`base` → `target`) but describe the *same*
 * semantic entity across a re-import or an edit that changed its source identifier.
 */
export interface IdentityPair {
  readonly base: EntityId;
  readonly target: EntityId;
}

/**
 * The user's confirmed answers about cross-snapshot identity, consumed by the semantic
 * matcher. `confirmed` pairs are treated as ground truth (they outrank semantic-key and
 * similarity matches); `rejected` pairs are the ones the user has ruled out, so a rejected
 * pair is never re-offered as a suggestion. Keeping both means a match can be recomputed
 * deterministically from the snapshots plus this map, and the user never has to answer the
 * same question twice.
 */
export interface IdentityMap {
  readonly confirmed: readonly IdentityPair[];
  readonly rejected: readonly IdentityPair[];
}

/** An identity map with no answers yet — the starting point before any confirmation. */
export const EMPTY_IDENTITY_MAP: IdentityMap = { confirmed: [], rejected: [] };

function samePair(a: IdentityPair, b: IdentityPair): boolean {
  return a.base === b.base && a.target === b.target;
}

function withoutPair(
  pairs: readonly IdentityPair[],
  pair: IdentityPair,
): readonly IdentityPair[] {
  return pairs.filter((existing) => !samePair(existing, pair));
}

/**
 * Records that `base` and `target` are the same entity. The pair is added to `confirmed`
 * (deduplicated) and removed from `rejected` if it was previously ruled out, so confirming
 * flips a prior rejection. Returns a new map; the input is not mutated.
 */
export function confirmIdentity(
  map: IdentityMap,
  base: EntityId,
  target: EntityId,
): IdentityMap {
  const pair: IdentityPair = { base, target };
  return {
    confirmed: [...withoutPair(map.confirmed, pair), pair],
    rejected: withoutPair(map.rejected, pair),
  };
}

/**
 * Records that `base` and `target` are *not* the same entity. The pair moves to `rejected`
 * (so the matcher will never suggest it again) and is removed from `confirmed` if it was
 * previously asserted. Returns a new map; the input is not mutated.
 */
export function rejectIdentity(
  map: IdentityMap,
  base: EntityId,
  target: EntityId,
): IdentityMap {
  const pair: IdentityPair = { base, target };
  return {
    confirmed: withoutPair(map.confirmed, pair),
    rejected: [...withoutPair(map.rejected, pair), pair],
  };
}

/** True when the map contains a confirmed pairing of exactly `base` → `target`. */
export function isConfirmed(
  map: IdentityMap,
  base: EntityId,
  target: EntityId,
): boolean {
  return map.confirmed.some(
    (pair) => pair.base === base && pair.target === target,
  );
}

/** True when the map has ruled out `base` → `target` as a pairing. */
export function isRejected(
  map: IdentityMap,
  base: EntityId,
  target: EntityId,
): boolean {
  return map.rejected.some(
    (pair) => pair.base === base && pair.target === target,
  );
}
