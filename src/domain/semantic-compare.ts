import {
  createGraphSnapshot,
  type EdgeEntity,
  type EntityId,
  type GraphEntity,
  type GraphSnapshot,
  type NodeEntity,
  type SnapshotId,
} from "@/domain/graph";
import {
  isRejected,
  type IdentityMap,
  EMPTY_IDENTITY_MAP,
} from "@/domain/identity-map";
import {
  createStory,
  sceneId,
  type Action,
  type Scene,
  type Story,
  type StoryId,
} from "@/domain/story";

/**
 * How the matcher decided two entities are the same across snapshots, in descending order of
 * trust. `explicit` is a user-confirmed pairing; `semantic-key` is a shared importer id (the
 * default identity a re-import reconnects on); `similarity` is a fuzzy label/type match that
 * is only ever *offered* — never applied without confirmation.
 */
export type MatchStrategy = "explicit" | "semantic-key" | "similarity";

/** An applied pairing between a base and a target entity — treated as the same entity. */
export interface EntityMatch {
  readonly base: EntityId;
  readonly target: EntityId;
  readonly strategy: MatchStrategy;
  /** 1 for `explicit`/`semantic-key`; the similarity score (0–1) for `similarity`. */
  readonly confidence: number;
}

/**
 * A proposed identity the user has not yet ruled on. Suggestions are produced from label/type
 * similarity and are deliberately kept out of the applied {@link EntityMatch} set: until the
 * user confirms one, the two entities still read as an independent add/remove pair.
 */
export interface MatchSuggestion {
  readonly base: EntityId;
  readonly target: EntityId;
  readonly confidence: number;
  /**
   * True when the pairing is not the only plausible one — either `base` has more than one
   * candidate above threshold, or `target` is a candidate for more than one base. Ambiguous
   * suggestions must be confirmed before they change the diff.
   */
  readonly ambiguous: boolean;
  readonly reason: string;
}

export interface MatchResult {
  /** Applied pairings (explicit + semantic-key + canonical-endpoint edges). */
  readonly matches: readonly EntityMatch[];
  /** Similarity pairings awaiting confirmation. */
  readonly suggestions: readonly MatchSuggestion[];
  /** Base entities with no applied match. */
  readonly unmatchedBase: readonly EntityId[];
  /** Target entities with no applied match. */
  readonly unmatchedTarget: readonly EntityId[];
}

/** The categories of semantic change a diff can report. Order is significant: it is the */
/** priority used to pick a single "primary" category for an entity in the views. */
export const CHANGE_CATEGORIES = [
  "added",
  "removed",
  "renamed",
  "moved",
  "rewired",
  "metadata-changed",
] as const;

export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

/**
 * One semantic change between the base and target architectures. A single matched entity can
 * produce several records (e.g. a node that was both renamed and moved) so that each category
 * can be filtered and animated on its own. `added`/`removed` carry the whole entity; the
 * paired categories carry both sides plus a category-specific description of what changed.
 */
export type ChangeRecord =
  | { readonly category: "added"; readonly entityId: EntityId; readonly after: GraphEntity }
  | { readonly category: "removed"; readonly entityId: EntityId; readonly before: GraphEntity }
  | {
      readonly category: "renamed";
      readonly baseId: EntityId;
      readonly targetId: EntityId;
      readonly before: GraphEntity;
      readonly after: GraphEntity;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly category: "moved";
      readonly baseId: EntityId;
      readonly targetId: EntityId;
      readonly before: NodeEntity;
      readonly after: NodeEntity;
      readonly fromGroup: EntityId | null;
      readonly toGroup: EntityId | null;
    }
  | {
      readonly category: "rewired";
      readonly baseId: EntityId;
      readonly targetId: EntityId;
      readonly before: EdgeEntity;
      readonly after: EdgeEntity;
      readonly from: { readonly source: EntityId; readonly target: EntityId };
      readonly to: { readonly source: EntityId; readonly target: EntityId };
    }
  | {
      readonly category: "metadata-changed";
      readonly baseId: EntityId;
      readonly targetId: EntityId;
      readonly before: GraphEntity;
      readonly after: GraphEntity;
      readonly changed: readonly string[];
    };

export interface ArchitectureDiff {
  readonly baseSnapshotId: SnapshotId;
  readonly targetSnapshotId: SnapshotId;
  readonly matches: readonly EntityMatch[];
  readonly suggestions: readonly MatchSuggestion[];
  readonly records: readonly ChangeRecord[];
}

export interface MatchOptions {
  /**
   * Minimum similarity (0–1) for a fuzzy pairing to be offered as a suggestion. Applied
   * matches (explicit, shared key) ignore this. Defaults to 0.5.
   */
  readonly similarityThreshold?: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

/** The stable id a change record hangs off of: the target id when the entity survives, */
/** otherwise the id it had on the side where it exists. This id is guaranteed to exist in */
/** the overlay {@link buildCompareSnapshot}, so it is safe to animate. */
export function recordEntityId(record: ChangeRecord): EntityId {
  switch (record.category) {
    case "added":
    case "removed":
      return record.entityId;
    default:
      return record.targetId;
  }
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      current.push(
        Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + cost),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Normalized string similarity in [0, 1]: 1 for equal strings, 0 for maximally different. */
function labelSimilarity(a: string, b: string): number {
  const left = normalizeLabel(a);
  const right = normalizeLabel(b);
  if (left === right) return 1;
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(left, right) / longest;
}

function entityLabel(entity: GraphEntity): string {
  return entity.kind === "edge" ? (entity.label ?? "") : entity.label;
}

function attributesOf(entity: GraphEntity): Readonly<Record<string, string>> {
  return entity.kind === "group" ? {} : (entity.attributes ?? {});
}

function attributesEqual(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function changedAttributeKeys(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => a[key] !== b[key]).sort();
}

function indexById(
  entities: readonly GraphEntity[],
): Map<EntityId, GraphEntity> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

/**
 * Pairs entities across two snapshots. Applied matches come, in order, from the user's
 * confirmed identity map, then from a shared semantic key (the importer source id, which is
 * how a re-import reconnects), then — for edges only — from endpoints that line up once node
 * identity is resolved. Everything left over is scored by label/type similarity and offered
 * as a {@link MatchSuggestion}; similarity never becomes an applied match on its own, and a
 * pair the user has rejected is never re-offered.
 */
export function matchEntities(
  base: GraphSnapshot,
  target: GraphSnapshot,
  identityMap: IdentityMap = EMPTY_IDENTITY_MAP,
  options: MatchOptions = {},
): MatchResult {
  const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const baseById = indexById(base.entities);
  const targetById = indexById(target.entities);

  const consumedBase = new Set<EntityId>();
  const consumedTarget = new Set<EntityId>();
  const matches: EntityMatch[] = [];

  const apply = (
    baseEntity: GraphEntity,
    targetEntity: GraphEntity,
    strategy: MatchStrategy,
    confidence: number,
  ): void => {
    matches.push({
      base: baseEntity.id,
      target: targetEntity.id,
      strategy,
      confidence,
    });
    consumedBase.add(baseEntity.id);
    consumedTarget.add(targetEntity.id);
  };

  for (const pair of identityMap.confirmed) {
    const baseEntity = baseById.get(pair.base);
    const targetEntity = targetById.get(pair.target);
    if (
      baseEntity &&
      targetEntity &&
      baseEntity.kind === targetEntity.kind &&
      !consumedBase.has(baseEntity.id) &&
      !consumedTarget.has(targetEntity.id)
    ) {
      apply(baseEntity, targetEntity, "explicit", 1);
    }
  }

  for (const baseEntity of base.entities) {
    if (consumedBase.has(baseEntity.id)) continue;
    const targetEntity = targetById.get(baseEntity.id);
    if (
      targetEntity &&
      targetEntity.kind === baseEntity.kind &&
      !consumedTarget.has(targetEntity.id)
    ) {
      apply(baseEntity, targetEntity, "semantic-key", 1);
    }
  }

  const canonicalBase = canonicalMap(matches);

  for (const baseEntity of base.entities) {
    if (baseEntity.kind !== "edge" || consumedBase.has(baseEntity.id)) continue;
    const targetEntity = target.entities.find(
      (candidate): candidate is EdgeEntity =>
        candidate.kind === "edge" &&
        !consumedTarget.has(candidate.id) &&
        endpointsMatch(baseEntity, candidate, canonicalBase),
    );
    if (targetEntity) apply(baseEntity, targetEntity, "semantic-key", 1);
  }

  const suggestions = suggestMatches(
    base,
    target,
    consumedBase,
    consumedTarget,
    canonicalBase,
    identityMap,
    threshold,
  );

  const unmatchedBase = base.entities
    .filter((entity) => !consumedBase.has(entity.id))
    .map((entity) => entity.id);
  const unmatchedTarget = target.entities
    .filter((entity) => !consumedTarget.has(entity.id))
    .map((entity) => entity.id);

  return { matches, suggestions, unmatchedBase, unmatchedTarget };
}

/** Maps every matched base id to its canonical (target) id; unmatched ids map to themselves. */
function canonicalMap(matches: readonly EntityMatch[]): Map<EntityId, EntityId> {
  const map = new Map<EntityId, EntityId>();
  for (const match of matches) map.set(match.base, match.target);
  return map;
}

function resolveBase(
  id: EntityId,
  canonicalBase: Map<EntityId, EntityId>,
): EntityId {
  return canonicalBase.get(id) ?? id;
}

/** True when two edges connect the same endpoints once base ids are resolved to canonical. */
function endpointsMatch(
  baseEdge: EdgeEntity,
  targetEdge: EdgeEntity,
  canonicalBase: Map<EntityId, EntityId>,
): boolean {
  return (
    resolveBase(baseEdge.source, canonicalBase) === targetEdge.source &&
    resolveBase(baseEdge.target, canonicalBase) === targetEdge.target
  );
}

function sharedEndpointCount(
  baseEdge: EdgeEntity,
  targetEdge: EdgeEntity,
  canonicalBase: Map<EntityId, EntityId>,
): number {
  let shared = 0;
  if (resolveBase(baseEdge.source, canonicalBase) === targetEdge.source) shared += 1;
  if (resolveBase(baseEdge.target, canonicalBase) === targetEdge.target) shared += 1;
  return shared;
}

interface Candidate {
  readonly base: EntityId;
  readonly target: EntityId;
  readonly score: number;
  readonly reason: string;
}

function suggestMatches(
  base: GraphSnapshot,
  target: GraphSnapshot,
  consumedBase: ReadonlySet<EntityId>,
  consumedTarget: ReadonlySet<EntityId>,
  canonicalBase: Map<EntityId, EntityId>,
  identityMap: IdentityMap,
  threshold: number,
): MatchSuggestion[] {
  const openBase = base.entities.filter((e) => !consumedBase.has(e.id));
  const openTarget = target.entities.filter((e) => !consumedTarget.has(e.id));

  const candidates: Candidate[] = [];
  for (const baseEntity of openBase) {
    for (const targetEntity of openTarget) {
      if (baseEntity.kind !== targetEntity.kind) continue;
      if (isRejected(identityMap, baseEntity.id, targetEntity.id)) continue;

      if (baseEntity.kind === "edge" && targetEntity.kind === "edge") {
        const shared = sharedEndpointCount(baseEntity, targetEntity, canonicalBase);
        if (shared < 1) continue;
        const label = labelSimilarity(entityLabel(baseEntity), entityLabel(targetEntity));
        const score = 0.6 * (shared / 2) + 0.4 * label;
        if (score >= threshold) {
          candidates.push({
            base: baseEntity.id,
            target: targetEntity.id,
            score,
            reason: `shares ${shared} endpoint${shared === 1 ? "" : "s"}`,
          });
        }
      } else {
        const label = labelSimilarity(entityLabel(baseEntity), entityLabel(targetEntity));
        const attrs = attributesEqual(
          attributesOf(baseEntity),
          attributesOf(targetEntity),
        )
          ? 1
          : 0;
        const score = 0.85 * label + 0.15 * attrs;
        if (score >= threshold) {
          candidates.push({
            base: baseEntity.id,
            target: targetEntity.id,
            score,
            reason: `${Math.round(label * 100)}% label match`,
          });
        }
      }
    }
  }

  const perBase = new Map<EntityId, number>();
  const perTarget = new Map<EntityId, number>();
  for (const candidate of candidates) {
    perBase.set(candidate.base, (perBase.get(candidate.base) ?? 0) + 1);
    perTarget.set(candidate.target, (perTarget.get(candidate.target) ?? 0) + 1);
  }

  const bestPerBase = new Map<EntityId, Candidate>();
  for (const candidate of candidates) {
    const current = bestPerBase.get(candidate.base);
    if (!current || candidate.score > current.score) {
      bestPerBase.set(candidate.base, candidate);
    }
  }

  return [...bestPerBase.values()]
    .sort((a, b) => b.score - a.score || a.base.localeCompare(b.base))
    .map((candidate) => ({
      base: candidate.base,
      target: candidate.target,
      confidence: candidate.score,
      ambiguous:
        (perBase.get(candidate.base) ?? 0) > 1 ||
        (perTarget.get(candidate.target) ?? 0) > 1,
      reason: candidate.reason,
    }));
}

/**
 * Computes the full semantic {@link ArchitectureDiff}. Matching resolves identity first (see
 * {@link matchEntities}); every applied pair is then inspected for renamed / moved / rewired /
 * metadata changes, and anything unmatched becomes an add or a remove. Because identity is
 * resolved before differencing, a node whose source id changed — once confirmed — is a rename
 * or a no-op, and its edges are rewires rather than unrelated delete/add pairs. Layout is
 * never consulted, so a pure re-layout yields no records.
 */
export function diffArchitectures(
  base: GraphSnapshot,
  target: GraphSnapshot,
  identityMap: IdentityMap = EMPTY_IDENTITY_MAP,
  options: MatchOptions = {},
): ArchitectureDiff {
  const match = matchEntities(base, target, identityMap, options);
  const baseById = indexById(base.entities);
  const targetById = indexById(target.entities);
  const canonicalBase = canonicalMap(match.matches);

  const records: ChangeRecord[] = [];

  for (const pair of match.matches) {
    const before = baseById.get(pair.base);
    const after = targetById.get(pair.target);
    if (!before || !after || before.kind !== after.kind) continue;
    records.push(...pairRecords(before, after, canonicalBase));
  }

  for (const id of match.unmatchedBase) {
    const before = baseById.get(id);
    if (before) records.push({ category: "removed", entityId: id, before });
  }
  for (const id of match.unmatchedTarget) {
    const after = targetById.get(id);
    if (after) records.push({ category: "added", entityId: id, after });
  }

  return {
    baseSnapshotId: base.id,
    targetSnapshotId: target.id,
    matches: match.matches,
    suggestions: match.suggestions,
    records: sortRecords(records),
  };
}

function pairRecords(
  before: GraphEntity,
  after: GraphEntity,
  canonicalBase: Map<EntityId, EntityId>,
): ChangeRecord[] {
  const out: ChangeRecord[] = [];
  const baseId = before.id;
  const targetId = after.id;

  if (entityLabel(before) !== entityLabel(after)) {
    out.push({
      category: "renamed",
      baseId,
      targetId,
      before,
      after,
      from: entityLabel(before),
      to: entityLabel(after),
    });
  }

  if (before.kind === "node" && after.kind === "node") {
    const fromGroup = before.groupId
      ? resolveBase(before.groupId, canonicalBase)
      : null;
    const toGroup = after.groupId ?? null;
    if (fromGroup !== toGroup) {
      out.push({
        category: "moved",
        baseId,
        targetId,
        before,
        after,
        fromGroup: before.groupId ?? null,
        toGroup: after.groupId ?? null,
      });
    }
  }

  if (before.kind === "edge" && after.kind === "edge") {
    if (!endpointsMatch(before, after, canonicalBase)) {
      out.push({
        category: "rewired",
        baseId,
        targetId,
        before,
        after,
        from: { source: before.source, target: before.target },
        to: { source: after.source, target: after.target },
      });
    }
  }

  if (before.kind === "group" && after.kind === "group") {
    const beforeMembers = before.memberIds
      .map((id) => resolveBase(id, canonicalBase))
      .slice()
      .sort();
    const afterMembers = after.memberIds.slice().sort();
    if (JSON.stringify(beforeMembers) !== JSON.stringify(afterMembers)) {
      out.push({
        category: "metadata-changed",
        baseId,
        targetId,
        before,
        after,
        changed: ["memberIds"],
      });
    }
  } else if (
    !attributesEqual(attributesOf(before), attributesOf(after))
  ) {
    out.push({
      category: "metadata-changed",
      baseId,
      targetId,
      before,
      after,
      changed: changedAttributeKeys(attributesOf(before), attributesOf(after)),
    });
  }

  return out;
}

function categoryRank(category: ChangeCategory): number {
  return CHANGE_CATEGORIES.indexOf(category);
}

function sortRecords(records: readonly ChangeRecord[]): ChangeRecord[] {
  return [...records].sort(
    (a, b) =>
      categoryRank(a.category) - categoryRank(b.category) ||
      recordEntityId(a).localeCompare(recordEntityId(b)),
  );
}

/** Keeps only the records in the given categories, preserving order. */
export function filterChanges(
  records: readonly ChangeRecord[],
  categories: readonly ChangeCategory[],
): ChangeRecord[] {
  const wanted = new Set(categories);
  return records.filter((record) => wanted.has(record.category));
}

/** Human-facing label for a change category, used in scene titles and annotations. */
export function changeCategoryLabel(category: ChangeCategory): string {
  switch (category) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "renamed":
      return "Renamed";
    case "moved":
      return "Moved";
    case "rewired":
      return "Rewired";
    case "metadata-changed":
      return "Metadata changed";
  }
}

export type SideStatus = ChangeCategory | "unchanged";

export interface SideEntity {
  readonly entity: GraphEntity;
  readonly status: SideStatus;
  /** The paired entity on the other side, when this entity was matched. */
  readonly counterpart?: EntityId;
}

export interface SideBySideView {
  readonly base: readonly SideEntity[];
  readonly target: readonly SideEntity[];
}

function primaryPairedCategory(
  categories: readonly ChangeCategory[],
): SideStatus {
  const ranked = categories
    .filter((category) => category !== "added" && category !== "removed")
    .sort((a, b) => categoryRank(a) - categoryRank(b));
  return ranked[0] ?? "unchanged";
}

function categoriesByTargetId(
  diff: ArchitectureDiff,
): Map<EntityId, ChangeCategory[]> {
  const byTarget = new Map<EntityId, ChangeCategory[]>();
  for (const record of diff.records) {
    if (record.category === "added" || record.category === "removed") continue;
    const list = byTarget.get(record.targetId) ?? [];
    list.push(record.category);
    byTarget.set(record.targetId, list);
  }
  return byTarget;
}

/**
 * Projects the diff into two aligned columns for a side-by-side review, listing *every*
 * entity of each snapshot. Each base entity is tagged `removed`, its primary change category,
 * or `unchanged`; each target entity `added`, its primary change category, or `unchanged`.
 * Matched entities carry a `counterpart` so a renderer can draw the correspondence — including
 * across a renamed source id.
 */
export function buildSideBySideView(
  base: GraphSnapshot,
  target: GraphSnapshot,
  diff: ArchitectureDiff,
): SideBySideView {
  const baseToTarget = new Map(diff.matches.map((m) => [m.base, m.target]));
  const targetToBase = new Map(diff.matches.map((m) => [m.target, m.base]));
  const removed = new Set(
    diff.records.flatMap((r) => (r.category === "removed" ? [r.entityId] : [])),
  );
  const added = new Set(
    diff.records.flatMap((r) => (r.category === "added" ? [r.entityId] : [])),
  );
  const categoriesByTarget = categoriesByTargetId(diff);

  const baseColumn: SideEntity[] = base.entities.map((entity) => {
    if (removed.has(entity.id)) return { entity, status: "removed" };
    const counterpart = baseToTarget.get(entity.id);
    return {
      entity,
      status: primaryPairedCategory(
        categoriesByTarget.get(counterpart ?? entity.id) ?? [],
      ),
      ...(counterpart !== undefined ? { counterpart } : {}),
    };
  });

  const targetColumn: SideEntity[] = target.entities.map((entity) => {
    if (added.has(entity.id)) return { entity, status: "added" };
    const counterpart = targetToBase.get(entity.id);
    return {
      entity,
      status: primaryPairedCategory(categoriesByTarget.get(entity.id) ?? []),
      ...(counterpart !== undefined ? { counterpart } : {}),
    };
  });

  return { base: baseColumn, target: targetColumn };
}

export interface OverlayEntity {
  /** Canonical id: the target id for surviving entities, the base id for removed ones. */
  readonly id: EntityId;
  readonly status: "added" | "removed" | "unchanged" | ChangeCategory;
  readonly base?: GraphEntity;
  readonly target?: GraphEntity;
  readonly categories: readonly ChangeCategory[];
}

export interface OverlayView {
  readonly entities: readonly OverlayEntity[];
}

/**
 * Projects the diff into a single merged list keyed by canonical id — the shape an overlay
 * renderer draws on one canvas. Surviving entities carry both sides and every change category
 * that applies; added and removed entities carry only the side they exist on.
 */
export function buildOverlayView(
  base: GraphSnapshot,
  target: GraphSnapshot,
  diff: ArchitectureDiff,
): OverlayView {
  const baseById = indexById(base.entities);
  const targetById = indexById(target.entities);
  const categoriesByTarget = categoriesByTargetId(diff);
  const added = new Set(
    diff.records.flatMap((r) => (r.category === "added" ? [r.entityId] : [])),
  );
  const removed = new Set(
    diff.records.flatMap((r) => (r.category === "removed" ? [r.entityId] : [])),
  );

  const entities: OverlayEntity[] = [];

  for (const match of diff.matches) {
    const baseEntity = baseById.get(match.base);
    const targetEntity = targetById.get(match.target);
    const categories = categoriesByTarget.get(match.target) ?? [];
    entities.push({
      id: match.target,
      status: primaryPairedCategory(categories) as OverlayEntity["status"],
      ...(baseEntity ? { base: baseEntity } : {}),
      ...(targetEntity ? { target: targetEntity } : {}),
      categories,
    });
  }

  for (const id of added) {
    const targetEntity = targetById.get(id);
    if (targetEntity) {
      entities.push({ id, status: "added", target: targetEntity, categories: [] });
    }
  }

  for (const id of removed) {
    const baseEntity = baseById.get(id);
    if (baseEntity) {
      entities.push({ id, status: "removed", base: baseEntity, categories: [] });
    }
  }

  return { entities: entities.sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * Builds a valid overlay snapshot containing the union of both architectures in canonical id
 * space: every target entity as-is, plus every removed base entity with its references
 * remapped through node identity so the graph stays referentially intact. This is the
 * snapshot a compare story animates against, so that both surviving *and* removed entities can
 * be revealed and highlighted.
 */
export function buildCompareSnapshot(
  id: SnapshotId,
  base: GraphSnapshot,
  target: GraphSnapshot,
  identityMap: IdentityMap = EMPTY_IDENTITY_MAP,
  options: MatchOptions = {},
): GraphSnapshot {
  const match = matchEntities(base, target, identityMap, options);
  const canonicalBase = canonicalMap(match.matches);
  const removed = new Set(match.unmatchedBase);

  const entities: GraphEntity[] = [...target.entities];
  const present = new Set(entities.map((entity) => entity.id));

  for (const entity of base.entities) {
    if (!removed.has(entity.id) || present.has(entity.id)) continue;
    entities.push(remapEntity(entity, canonicalBase));
    present.add(entity.id);
  }

  return createGraphSnapshot({ id, source: target.source, entities });
}

function remapEntity(
  entity: GraphEntity,
  canonicalBase: Map<EntityId, EntityId>,
): GraphEntity {
  switch (entity.kind) {
    case "node":
      return entity.groupId
        ? { ...entity, groupId: resolveBase(entity.groupId, canonicalBase) }
        : entity;
    case "edge":
      return {
        ...entity,
        source: resolveBase(entity.source, canonicalBase),
        target: resolveBase(entity.target, canonicalBase),
      };
    case "group":
      return {
        ...entity,
        memberIds: entity.memberIds.map((id) => resolveBase(id, canonicalBase)),
      };
  }
}

export interface CompareStoryInput {
  readonly id: StoryId;
  readonly title: string;
  /** The overlay snapshot from {@link buildCompareSnapshot} the story animates. */
  readonly snapshot: GraphSnapshot;
  readonly records: readonly ChangeRecord[];
  /** Optional filter; when omitted, every category present is animated. */
  readonly categories?: readonly ChangeCategory[];
  /** Per-scene duration in milliseconds. Defaults to 1500. */
  readonly durationMs?: number;
}

const DEFAULT_SCENE_DURATION_MS = 1500;

/**
 * Converts selected change records into a compare {@link Story}: one scene per change category
 * (in {@link CHANGE_CATEGORIES} order), each revealing and highlighting the entities in that
 * category with the category name as the emphasis style. Renamed entities are annotated with
 * their before/after labels. The story targets the overlay snapshot, so every referenced id is
 * present and the result validates against it.
 */
export function changesToCompareStory(input: CompareStoryInput): Story {
  const durationMs = input.durationMs ?? DEFAULT_SCENE_DURATION_MS;
  const selected = input.categories
    ? filterChanges(input.records, input.categories)
    : input.records;

  const byCategory = new Map<ChangeCategory, ChangeRecord[]>();
  for (const record of selected) {
    const list = byCategory.get(record.category) ?? [];
    list.push(record);
    byCategory.set(record.category, list);
  }

  const scenes: Scene[] = [];
  for (const category of CHANGE_CATEGORIES) {
    const records = byCategory.get(category);
    if (!records || records.length === 0) continue;

    const actions: Action[] = [];
    const focus: EntityId[] = [];
    for (const record of records) {
      const id = recordEntityId(record);
      focus.push(id);
      actions.push({ type: "reveal", target: id });
      actions.push({ type: "highlight", target: id, style: category });
      if (record.category === "renamed") {
        actions.push({
          type: "annotate",
          target: id,
          text: `${record.from} → ${record.to}`,
        });
      }
    }
    actions.push({ type: "camera", focus });

    scenes.push({
      id: sceneId(`compare-${category}`),
      title: changeCategoryLabel(category),
      durationMs,
      actions,
    });
  }

  return createStory({
    id: input.id,
    title: input.title,
    snapshotId: input.snapshot.id,
    scenes,
  });
}
