import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

import type { EntityId, GraphSnapshot, LayoutHint } from "@/domain/graph";
import { DEFAULT_DIRECTION, type Direction } from "@/domain/mermaid/types";

/** A manual move of a single entity, stored separately from the computed layout. */
export interface LayoutOverride {
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
}

export interface LayoutOptions {
  readonly direction?: Direction;
  /** Default node width in px when a renderer has not measured one. */
  readonly nodeWidth?: number;
  /** Default node height in px when a renderer has not measured one. */
  readonly nodeHeight?: number;
}

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 48;

const DIRECTION_TO_ELK: Readonly<Record<Direction, string>> = {
  TD: "DOWN",
  TB: "DOWN",
  BT: "UP",
  LR: "RIGHT",
  RL: "LEFT",
};

/**
 * Deterministic layout options. ELK's layered algorithm is deterministic for a given input;
 * a fixed random seed and explicit model-order strategy pin it further so the same snapshot
 * always produces the same coordinates.
 */
function layoutOptions(direction: Direction): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": DIRECTION_TO_ELK[direction],
    "elk.randomSeed": "1",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.layered.spacing.nodeNodeBetweenLayers": "48",
    "elk.spacing.nodeNode": "32",
  };
}

/**
 * Builds the ELK graph for a snapshot: group entities become compound (nested) ELK nodes,
 * plain nodes become their children (or top-level children when ungrouped), and edges become
 * ELK edges. Membership comes from each node's `groupId`, so the ELK hierarchy mirrors the
 * subgraph structure.
 */
function toElkGraph(
  snapshot: GraphSnapshot,
  options: Required<Omit<LayoutOptions, "direction">>,
  direction: Direction,
): ElkNode {
  const groupChildren = new Map<string, ElkNode[]>();
  const topLevel: ElkNode[] = [];
  const groupIds = new Set(
    snapshot.entities
      .filter((e) => e.kind === "group")
      .map((e) => e.id as string),
  );

  for (const groupId of groupIds) {
    groupChildren.set(groupId, []);
  }

  for (const entity of snapshot.entities) {
    if (entity.kind !== "node") continue;
    const elkNode: ElkNode = {
      id: entity.id,
      width: options.nodeWidth,
      height: options.nodeHeight,
    };
    const parent = entity.groupId
      ? groupChildren.get(entity.groupId as string)
      : undefined;
    (parent ?? topLevel).push(elkNode);
  }

  for (const entity of snapshot.entities) {
    if (entity.kind !== "group") continue;
    const container: ElkNode = {
      id: entity.id,
      children: groupChildren.get(entity.id as string) ?? [],
      layoutOptions: { "elk.padding": "[top=32,left=16,bottom=16,right=16]" },
    };
    // Nested groups are represented via their members' groupId; a group whose members
    // are themselves grouped nests naturally because those members are ELK children of
    // the inner group, which is a top-level entity here.
    topLevel.push(container);
  }

  const edges = snapshot.entities
    .filter((e) => e.kind === "edge")
    .map((e) => ({
      id: e.id as string,
      sources: [(e as { source: EntityId }).source as string],
      targets: [(e as { target: EntityId }).target as string],
    }));

  return {
    id: "root",
    layoutOptions: layoutOptions(direction),
    children: topLevel,
    edges,
  };
}

/** Flattens ELK's parent-relative coordinates into absolute {@link LayoutHint}s. */
function collectHints(
  node: ElkNode,
  offsetX: number,
  offsetY: number,
  out: LayoutHint[],
): void {
  for (const child of node.children ?? []) {
    const x = offsetX + (child.x ?? 0);
    const y = offsetY + (child.y ?? 0);
    out.push({
      entityId: child.id as unknown as EntityId,
      x,
      y,
      ...(child.width !== undefined ? { width: child.width } : {}),
      ...(child.height !== undefined ? { height: child.height } : {}),
    });
    if (child.children && child.children.length > 0) {
      collectHints(child, x, y, out);
    }
  }
}

/**
 * Runs deterministic ELK layout over a snapshot and returns renderer-neutral
 * {@link LayoutHint}s (absolute coordinates) for every node and group. The snapshot's source
 * and entities are never touched — layout is derived data — so a later visual move is stored
 * as a separate {@link LayoutOverride} and never rewrites the Mermaid source.
 */
export async function layoutFlowchart(
  snapshot: GraphSnapshot,
  options: LayoutOptions = {},
): Promise<LayoutHint[]> {
  const resolved = {
    nodeWidth: options.nodeWidth ?? DEFAULT_NODE_WIDTH,
    nodeHeight: options.nodeHeight ?? DEFAULT_NODE_HEIGHT,
  };
  const direction = options.direction ?? DEFAULT_DIRECTION;

  const elk = new ELK();
  const graph = toElkGraph(snapshot, resolved, direction);
  const laidOut = await elk.layout(graph);

  const hints: LayoutHint[] = [];
  collectHints(laidOut, 0, 0, hints);
  hints.sort((a, b) =>
    (a.entityId as string).localeCompare(b.entityId as string),
  );
  return hints;
}

/**
 * Layers manual moves on top of a computed layout. Overrides are matched by entity id and
 * replace only the position (width/height are preserved); overrides for entities absent from
 * the base are appended. The base layout is never mutated, keeping computed positions and
 * user moves as strictly separate inputs — the guarantee behind "visual moves never rewrite
 * Mermaid".
 */
export function mergeLayoutOverrides(
  base: readonly LayoutHint[],
  overrides: readonly LayoutOverride[],
): LayoutHint[] {
  const overrideById = new Map(overrides.map((o) => [o.entityId, o]));
  const merged = base.map((hint) => {
    const override = overrideById.get(hint.entityId);
    if (!override) return hint;
    overrideById.delete(hint.entityId);
    return { ...hint, x: override.x, y: override.y };
  });
  for (const override of overrideById.values()) {
    merged.push({ entityId: override.entityId, x: override.x, y: override.y });
  }
  return merged;
}
