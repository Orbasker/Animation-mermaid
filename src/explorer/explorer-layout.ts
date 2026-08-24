import type { EntityId } from "@/domain/graph";

import type { VisibleGraph } from "@/explorer/explorer-model";

/**
 * A deterministic, ELK-free layout for the explorer's current view. Containers are drawn as nested
 * frames whose children — leaves, collapsed summaries, and further containers — flow in a wrapped
 * grid; a container's size is measured bottom-up from its content, then positioned top-down into
 * absolute coordinates. Being pure and synchronous, it lays out on every collapse/expand toggle
 * without a worker, and is unit-testable in isolation from React.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PositionedNode {
  readonly id: EntityId;
  readonly rect: Rect;
}

export interface PositionedEdge {
  readonly id: EntityId;
  readonly source: EntityId;
  readonly target: EntityId;
  readonly aggregated: boolean;
  readonly label?: string;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
}

export interface PositionedGraph {
  readonly leaves: readonly PositionedNode[];
  readonly containers: readonly PositionedNode[];
  readonly edges: readonly PositionedEdge[];
  readonly width: number;
  readonly height: number;
}

export interface ExplorerLayoutOptions {
  readonly leafWidth?: number;
  readonly leafHeight?: number;
  readonly gap?: number;
  readonly padding?: number;
  readonly headerHeight?: number;
  /** Upper bound on grid columns before children wrap to the next row. */
  readonly maxColumns?: number;
}

const DEFAULTS: Required<ExplorerLayoutOptions> = {
  leafWidth: 156,
  leafHeight: 56,
  gap: 24,
  padding: 18,
  headerHeight: 34,
  maxColumns: 4,
};

interface MeasuredBox {
  readonly id: EntityId;
  readonly kind: "leaf" | "container";
  readonly width: number;
  readonly height: number;
  readonly children: readonly MeasuredBox[];
}

/**
 * Derives everything the explorer needs to draw the {@link VisibleGraph}: rectangles for leaves and
 * container frames (absolute, top-left origin), plus edges resolved to the centre points of their
 * endpoints. Layout is purely a function of the view and options, so identical views lay out
 * identically.
 */
export function layoutVisibleGraph(
  view: VisibleGraph,
  options: ExplorerLayoutOptions = {},
): PositionedGraph {
  const opts = { ...DEFAULTS, ...options };

  const childrenByParent = new Map<string, EntityId[]>();
  const push = (parent: EntityId | undefined, id: EntityId) => {
    const key = parent ?? "";
    const list = childrenByParent.get(key);
    if (list) list.push(id);
    else childrenByParent.set(key, [id]);
  };
  for (const container of view.containers) push(container.parent, container.id);
  for (const node of view.nodes) push(node.parent, node.id);

  const isContainer = new Set(view.containers.map((c) => c.id));

  const columnsFor = (count: number): number =>
    Math.max(1, Math.min(opts.maxColumns, Math.ceil(Math.sqrt(count))));

  // Bottom-up: a leaf is a fixed box; a container measures its children in a wrapped grid, then
  // sizes itself to enclose them beneath a header.
  const measure = (id: EntityId): MeasuredBox => {
    if (!isContainer.has(id)) {
      return {
        id,
        kind: "leaf",
        width: opts.leafWidth,
        height: opts.leafHeight,
        children: [],
      };
    }
    const childIds = childrenByParent.get(id) ?? [];
    const children = childIds.map(measure);
    const { width, height } = measureFlow(children, opts, columnsFor);
    return { id, kind: "container", width, height, children };
  };

  const rootIds = childrenByParent.get("") ?? [];
  const roots = rootIds.map(measure);
  const canvas = measureFlow(roots, opts, columnsFor, /* header */ false);

  const leaves: PositionedNode[] = [];
  const containers: PositionedNode[] = [];
  const centres = new Map<EntityId, { x: number; y: number }>();

  // Top-down: place each box's children in the same wrapped grid used to measure it, offset by the
  // box's own origin and header.
  const place = (box: MeasuredBox, originX: number, originY: number) => {
    const rect: Rect = {
      x: originX,
      y: originY,
      width: box.width,
      height: box.height,
    };
    centres.set(box.id, {
      x: originX + box.width / 2,
      y: originY + box.height / 2,
    });
    if (box.kind === "leaf") {
      leaves.push({ id: box.id, rect });
      return;
    }
    containers.push({ id: box.id, rect });
    placeFlow(
      box.children,
      originX,
      originY + opts.headerHeight,
      opts,
      columnsFor,
      place,
    );
  };

  placeFlow(roots, 0, 0, opts, columnsFor, place, /* header */ false);

  const edges: PositionedEdge[] = [];
  for (const edge of view.edges) {
    const from = centres.get(edge.source);
    const to = centres.get(edge.target);
    if (!from || !to) continue;
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      aggregated: edge.aggregated,
      from,
      to,
      ...(edge.label !== undefined ? { label: edge.label } : {}),
    });
  }

  return {
    leaves,
    containers,
    edges,
    width: Math.max(canvas.width, opts.leafWidth + opts.padding * 2),
    height: Math.max(canvas.height, opts.leafHeight + opts.padding * 2),
  };
}

/** Measures the bounding size of a wrapped grid of boxes (optionally under a container header). */
function measureFlow(
  boxes: readonly MeasuredBox[],
  opts: Required<ExplorerLayoutOptions>,
  columnsFor: (count: number) => number,
  header = true,
): { width: number; height: number } {
  if (boxes.length === 0) {
    return {
      width: opts.leafWidth + opts.padding * 2,
      height: (header ? opts.headerHeight : 0) + opts.leafHeight + opts.padding,
    };
  }
  const cols = columnsFor(boxes.length);
  let x = opts.padding;
  let rowTop = header ? opts.headerHeight : opts.padding;
  let rowHeight = 0;
  let maxRight = 0;
  let col = 0;
  for (const box of boxes) {
    maxRight = Math.max(maxRight, x + box.width);
    rowHeight = Math.max(rowHeight, box.height);
    x += box.width + opts.gap;
    col += 1;
    if (col >= cols) {
      col = 0;
      x = opts.padding;
      rowTop += rowHeight + opts.gap;
      rowHeight = 0;
    }
  }
  const bottom = rowTop + rowHeight;
  return {
    width: maxRight + opts.padding,
    height: bottom + opts.padding,
  };
}

/** Places a wrapped grid of boxes at an absolute origin, recursing into each via `place`. */
function placeFlow(
  boxes: readonly MeasuredBox[],
  originX: number,
  originY: number,
  opts: Required<ExplorerLayoutOptions>,
  columnsFor: (count: number) => number,
  place: (box: MeasuredBox, x: number, y: number) => void,
  header = true,
): void {
  if (boxes.length === 0) return;
  const cols = columnsFor(boxes.length);
  let x = opts.padding;
  let rowTop = header ? 0 : opts.padding;
  let rowHeight = 0;
  let col = 0;
  for (const box of boxes) {
    place(box, originX + x, originY + rowTop);
    rowHeight = Math.max(rowHeight, box.height);
    x += box.width + opts.gap;
    col += 1;
    if (col >= cols) {
      col = 0;
      x = opts.padding;
      rowTop += rowHeight + opts.gap;
      rowHeight = 0;
    }
  }
}
