import type {
  EdgeEntity,
  EntityId,
  GraphSnapshot,
  GroupEntity,
  NodeEntity,
} from "@/domain/graph";

/**
 * The interactive explorer works on *any* normalized {@link GraphSnapshot}: nodes that may name a
 * group, groups that may nest inside other groups, and directed edges. Everything below is derived
 * from that model alone — no renderer, no coordinates — so the same collapse / drill / search logic
 * drives the in-app surface, the exported HTML, and unit tests without change.
 */

/** A container (Mermaid `subgraph`) in the explorer hierarchy, with its recovered parent. */
export interface ExplorerContainer {
  readonly id: EntityId;
  readonly label: string;
  /** Enclosing container, when this one nests inside another; absent at the top level. */
  readonly parent?: EntityId;
  /** Nesting depth from the top level: a root container is depth 0, its child depth 1, and so on. */
  readonly depth: number;
}

/** A leaf node in the explorer hierarchy, with the container it directly belongs to (if any). */
export interface ExplorerLeaf {
  readonly id: EntityId;
  readonly label: string;
  readonly parent?: EntityId;
  readonly depth: number;
}

/**
 * A snapshot flattened into an indexed hierarchy the explorer can query cheaply: leaves and
 * containers keyed by id, the direct children of every container (and of the synthetic root), and
 * the edges. Build this once per snapshot; the interactive state ({@link ExplorerState}) is kept
 * separately so toggling collapse never rebuilds the hierarchy.
 */
export interface ExplorerGraph {
  readonly leaves: ReadonlyMap<EntityId, ExplorerLeaf>;
  readonly containers: ReadonlyMap<EntityId, ExplorerContainer>;
  readonly edges: readonly EdgeEntity[];
  /** Direct child ids (leaves and containers, in source order) of a container id, or of the root. */
  readonly childrenOf: (parent: EntityId | undefined) => readonly EntityId[];
}

const ROOT_KEY = "__root__";

function parentKey(parent: EntityId | undefined): string {
  return parent ?? ROOT_KEY;
}

/**
 * Builds the {@link ExplorerGraph} from a snapshot. Container nesting is recovered exactly as the
 * structure explorer does — a group is nested in whichever group lists it as a member — so both
 * node membership (`groupId`) and group-in-group nesting collapse to a single parent per entity.
 * Depth and child order are computed here so later passes stay O(visible).
 */
export function buildExplorerGraph(snapshot: GraphSnapshot): ExplorerGraph {
  const entities = snapshot.entities;

  const groupById = new Map<EntityId, GroupEntity>();
  for (const entity of entities) {
    if (entity.kind === "group") groupById.set(entity.id, entity);
  }

  // A container's parent is the container that lists it as a member.
  const containerParent = new Map<EntityId, EntityId>();
  for (const group of groupById.values()) {
    for (const memberId of group.memberIds) {
      if (groupById.has(memberId)) containerParent.set(memberId, group.id);
    }
  }

  const depthOf = (id: EntityId): number => {
    let depth = 0;
    let cursor = containerParent.get(id);
    while (cursor !== undefined) {
      depth += 1;
      cursor = containerParent.get(cursor);
    }
    return depth;
  };

  const containers = new Map<EntityId, ExplorerContainer>();
  for (const group of groupById.values()) {
    const parent = containerParent.get(group.id);
    containers.set(group.id, {
      id: group.id,
      label: group.label,
      depth: depthOf(group.id),
      ...(parent !== undefined ? { parent } : {}),
    });
  }

  const leaves = new Map<EntityId, ExplorerLeaf>();
  for (const entity of entities) {
    if (entity.kind !== "node") continue;
    const node = entity as NodeEntity;
    const parent = node.groupId;
    leaves.set(node.id, {
      id: node.id,
      label: node.label,
      depth: parent !== undefined ? depthOf(parent) + 1 : 0,
      ...(parent !== undefined ? { parent } : {}),
    });
  }

  // Direct children in source order, so the explorer renders containers and nodes as authored.
  const children = new Map<string, EntityId[]>();
  const push = (parent: EntityId | undefined, id: EntityId) => {
    const key = parentKey(parent);
    const list = children.get(key);
    if (list) list.push(id);
    else children.set(key, [id]);
  };
  for (const entity of entities) {
    if (entity.kind === "node") push(entity.groupId, entity.id);
    else if (entity.kind === "group")
      push(containerParent.get(entity.id), entity.id);
  }

  const edges = entities.filter(
    (entity): entity is EdgeEntity => entity.kind === "edge",
  );

  return {
    leaves,
    containers,
    edges,
    childrenOf: (parent) => children.get(parentKey(parent)) ?? [],
  };
}

/**
 * The interactive state of the explorer, kept separate from the immutable {@link ExplorerGraph}.
 * All operations below are pure: they take a state (and often the graph) and return a new state,
 * so the surface can undo, replay, or drive this from a reducer without hidden mutation.
 */
export interface ExplorerState {
  /** Containers folded into a single summary box; their descendants are not drawn. */
  readonly collapsed: ReadonlySet<EntityId>;
  /**
   * The drill stack. Empty means the whole graph is in view; otherwise the last id is the container
   * whose sub-diagram fills the view, and earlier ids are the trail back out (the breadcrumb).
   */
  readonly drillPath: readonly EntityId[];
  /** Current search text; empty means no search is active. */
  readonly query: string;
  /** The entity a search or reveal last brought into focus, for the surface to highlight. */
  readonly focusId?: EntityId;
}

/** The initial, fully-expanded, top-level state. */
export function initialExplorerState(): ExplorerState {
  return { collapsed: new Set(), drillPath: [], query: "" };
}

/** Ancestor container ids of an entity, nearest first, up to (and excluding) the top level. */
export function ancestorsOf(
  graph: ExplorerGraph,
  id: EntityId,
): readonly EntityId[] {
  const ancestors: EntityId[] = [];
  let cursor = graph.leaves.get(id)?.parent ?? graph.containers.get(id)?.parent;
  while (cursor !== undefined) {
    ancestors.push(cursor);
    cursor = graph.containers.get(cursor)?.parent;
  }
  return ancestors;
}

function withCollapsed(
  state: ExplorerState,
  collapsed: ReadonlySet<EntityId>,
): ExplorerState {
  return { ...state, collapsed };
}

/** Collapses a container if expanded, or expands it if collapsed. */
export function toggleCollapse(
  state: ExplorerState,
  containerId: EntityId,
): ExplorerState {
  const next = new Set(state.collapsed);
  if (next.has(containerId)) next.delete(containerId);
  else next.add(containerId);
  return withCollapsed(state, next);
}

/** Collapses every container in the graph — the most aggregated view. */
export function collapseAll(
  state: ExplorerState,
  graph: ExplorerGraph,
): ExplorerState {
  return withCollapsed(state, new Set(graph.containers.keys()));
}

/** Expands every container — the fully-detailed view. */
export function expandAll(state: ExplorerState): ExplorerState {
  return withCollapsed(state, new Set());
}

/**
 * Sets the level of detail by nesting depth: containers shallower than `level` stay expanded and
 * everything at `level` or deeper is collapsed. `level` 0 collapses all root containers (maximum
 * aggregation); a level at or above the deepest container is equivalent to expand-all.
 */
export function setCollapseLevel(
  state: ExplorerState,
  graph: ExplorerGraph,
  level: number,
): ExplorerState {
  const collapsed = new Set<EntityId>();
  for (const container of graph.containers.values()) {
    if (container.depth >= level) collapsed.add(container.id);
  }
  return withCollapsed(state, collapsed);
}

/** The deepest container nesting in the graph, so the surface can bound its level control. */
export function maxContainerDepth(graph: ExplorerGraph): number {
  let max = -1;
  for (const container of graph.containers.values()) {
    if (container.depth > max) max = container.depth;
  }
  return max;
}

/**
 * Expands every ancestor of `id` and drops it from focus onto the view, so a search hit deep inside
 * collapsed containers becomes visible. Does not change the drill path — reveal works within the
 * current view; the surface can drill separately.
 */
export function revealEntity(
  state: ExplorerState,
  graph: ExplorerGraph,
  id: EntityId,
): ExplorerState {
  const collapsed = new Set(state.collapsed);
  for (const ancestor of ancestorsOf(graph, id)) collapsed.delete(ancestor);
  return { ...state, collapsed, focusId: id };
}

/** Drills into a container so its sub-diagram fills the view; records the trail for the breadcrumb. */
export function drillInto(
  state: ExplorerState,
  graph: ExplorerGraph,
  containerId: EntityId,
): ExplorerState {
  if (!graph.containers.has(containerId)) return state;
  if (state.drillPath[state.drillPath.length - 1] === containerId) return state;
  // Entering a container means seeing its contents, so it is never itself collapsed in the drill.
  const collapsed = new Set(state.collapsed);
  collapsed.delete(containerId);
  return { ...state, drillPath: [...state.drillPath, containerId], collapsed };
}

/**
 * Moves the drill view to a container already on the breadcrumb (or all the way out when `undefined`),
 * truncating the trail beyond it. Ignored when the target is not on the current path.
 */
export function drillTo(
  state: ExplorerState,
  containerId: EntityId | undefined,
): ExplorerState {
  if (containerId === undefined) return { ...state, drillPath: [] };
  const index = state.drillPath.indexOf(containerId);
  if (index === -1) return state;
  return { ...state, drillPath: state.drillPath.slice(0, index + 1) };
}

/** The container whose sub-diagram is currently in view, or `undefined` at the top level. */
export function currentDrillRoot(state: ExplorerState): EntityId | undefined {
  return state.drillPath[state.drillPath.length - 1];
}

/** One step of the breadcrumb trail from the whole graph down to the current drill root. */
export interface Breadcrumb {
  /** The container id, or `undefined` for the "All" root step. */
  readonly id?: EntityId;
  readonly label: string;
}

/** Builds the breadcrumb trail, starting with an "All" root step, from the drill path. */
export function breadcrumbTrail(
  state: ExplorerState,
  graph: ExplorerGraph,
  rootLabel = "All",
): readonly Breadcrumb[] {
  const trail: Breadcrumb[] = [{ label: rootLabel }];
  for (const id of state.drillPath) {
    trail.push({ id, label: graph.containers.get(id)?.label ?? String(id) });
  }
  return trail;
}

/** Case-insensitive substring match against an entity's label and id. */
function matches(query: string, label: string, id: EntityId): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return false;
  return (
    label.toLowerCase().includes(needle) ||
    String(id).toLowerCase().includes(needle)
  );
}

/** Every leaf and container whose label or id matches the query, in hierarchy order. */
export function searchEntities(
  graph: ExplorerGraph,
  query: string,
): readonly EntityId[] {
  if (query.trim().length === 0) return [];
  const hits: EntityId[] = [];
  for (const leaf of graph.leaves.values()) {
    if (matches(query, leaf.label, leaf.id)) hits.push(leaf.id);
  }
  for (const container of graph.containers.values()) {
    if (matches(query, container.label, container.id)) hits.push(container.id);
  }
  return hits;
}

/** A node drawn in the current view: either a real leaf, or a container collapsed to a summary. */
export interface VisibleNode {
  readonly id: EntityId;
  readonly label: string;
  readonly kind: "leaf" | "summary";
  /** The container that directly encloses this node within the current view, if any. */
  readonly parent?: EntityId;
  /** For a summary node, how many leaves it aggregates; `0` for a real leaf. */
  readonly aggregatedLeafCount: number;
}

/** A container drawn as an expanded frame in the current view (collapsed ones become summaries). */
export interface VisibleContainer {
  readonly id: EntityId;
  readonly label: string;
  readonly parent?: EntityId;
}

/** An edge in the current view, its endpoints already rewired to whatever is actually drawn. */
export interface VisibleEdge {
  readonly id: EntityId;
  readonly source: EntityId;
  readonly target: EntityId;
  readonly label?: string;
  /** True when this edge stands in for one or more edges hidden by collapse or drill. */
  readonly aggregated: boolean;
}

/** The fully-derived picture the renderer draws for a given graph + state. */
export interface VisibleGraph {
  readonly nodes: readonly VisibleNode[];
  readonly containers: readonly VisibleContainer[];
  readonly edges: readonly VisibleEdge[];
}

/**
 * Derives everything drawn for the current state: the visible nodes (real leaves plus collapsed
 * containers rendered as counted summary boxes), the expanded container frames, and the edges with
 * endpoints rewired to their nearest drawn ancestor. Edges that would start and end at the same
 * drawn node after rewiring are dropped; parallel edges between the same drawn pair collapse into a
 * single aggregated connector. Only the subtree under the current drill root is considered.
 */
export function deriveVisibleGraph(
  graph: ExplorerGraph,
  state: ExplorerState,
): VisibleGraph {
  const drillRoot = currentDrillRoot(state);

  // Membership in the drilled subtree: an entity is in view when the drill root is one of its
  // ancestors (or there is no drill root). The drill root's own frame is not drawn — it is the
  // canvas — so only its descendants appear.
  const inSubtree = (id: EntityId): boolean => {
    if (drillRoot === undefined) return true;
    return ancestorsOf(graph, id).includes(drillRoot);
  };

  // The nearest ancestor at or below the drill root that is collapsed, i.e. the summary an entity
  // folds into. Ancestors are nearest-first, so the *outermost* collapsed one wins.
  const representative = (id: EntityId): EntityId => {
    let rep = id;
    for (const ancestor of ancestorsOf(graph, id)) {
      if (ancestor === drillRoot) break;
      if (state.collapsed.has(ancestor)) rep = ancestor;
    }
    return rep;
  };

  // A container directly under the drill root has no drawn parent; otherwise its parent is that
  // enclosing container (which, by construction here, is expanded and in view).
  const drawnParent = (parent: EntityId | undefined): EntityId | undefined =>
    parent === drillRoot ? undefined : parent;

  const nodes: VisibleNode[] = [];
  const containers: VisibleContainer[] = [];
  const leafCount = new Map<EntityId, number>();

  for (const container of graph.containers.values()) {
    if (!inSubtree(container.id)) continue;
    if (representative(container.id) !== container.id) continue; // inside a collapsed ancestor
    if (state.collapsed.has(container.id)) {
      leafCount.set(container.id, 0);
      nodes.push({
        id: container.id,
        label: container.label,
        kind: "summary",
        aggregatedLeafCount: 0,
        ...(drawnParent(container.parent) !== undefined
          ? { parent: drawnParent(container.parent) }
          : {}),
      });
    } else {
      containers.push({
        id: container.id,
        label: container.label,
        ...(drawnParent(container.parent) !== undefined
          ? { parent: drawnParent(container.parent) }
          : {}),
      });
    }
  }

  for (const leaf of graph.leaves.values()) {
    if (!inSubtree(leaf.id)) continue;
    const rep = representative(leaf.id);
    if (rep !== leaf.id) {
      leafCount.set(rep, (leafCount.get(rep) ?? 0) + 1);
      continue;
    }
    nodes.push({
      id: leaf.id,
      label: leaf.label,
      kind: "leaf",
      aggregatedLeafCount: 0,
      ...(drawnParent(leaf.parent) !== undefined
        ? { parent: drawnParent(leaf.parent) }
        : {}),
    });
  }

  const drawnIds = new Set(nodes.map((node) => node.id));
  const summaries = nodes.map((node) =>
    node.kind === "summary"
      ? { ...node, aggregatedLeafCount: leafCount.get(node.id) ?? 0 }
      : node,
  );

  const edgeByPair = new Map<string, VisibleEdge>();
  for (const edge of graph.edges) {
    const source = representative(edge.source);
    const target = representative(edge.target);
    if (!drawnIds.has(source) || !drawnIds.has(target)) continue;
    if (source === target) continue;
    const key = `${source} ${target}`;
    const existing = edgeByPair.get(key);
    if (existing) {
      edgeByPair.set(key, { ...existing, aggregated: true });
      continue;
    }
    edgeByPair.set(key, {
      id: edge.id,
      source,
      target,
      aggregated: source !== edge.source || target !== edge.target,
      ...(edge.label !== undefined ? { label: edge.label } : {}),
    });
  }

  return {
    nodes: summaries,
    containers,
    edges: [...edgeByPair.values()],
  };
}
