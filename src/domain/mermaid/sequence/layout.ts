import type { GraphSnapshot, LayoutHint } from "@/domain/graph";

export interface SequenceLayoutOptions {
  /** Node width in px. */
  readonly nodeWidth?: number;
  /** Node height in px. */
  readonly nodeHeight?: number;
  /** Horizontal gap between participant lanes, measured between left edges. */
  readonly laneGap?: number;
}

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 48;
const DEFAULT_LANE_GAP = 220;

/**
 * Lays a sequence diagram out as participant lanes: every participant sits in a horizontal row
 * in declaration order, one lane apart. This is fully deterministic and needs no solver — the
 * spine of a sequence diagram is the participant order, and messages (edges) draw between lanes
 * without positions of their own, exactly as flowchart edges do. The snapshot's source and
 * entities are never touched; layout is derived data.
 */
export function layoutSequence(
  snapshot: GraphSnapshot,
  options: SequenceLayoutOptions = {},
): Promise<LayoutHint[]> {
  const width = options.nodeWidth ?? DEFAULT_NODE_WIDTH;
  const height = options.nodeHeight ?? DEFAULT_NODE_HEIGHT;
  const gap = options.laneGap ?? DEFAULT_LANE_GAP;

  const hints: LayoutHint[] = snapshot.entities
    .filter((entity) => entity.kind === "node")
    .map((entity, index) => ({
      entityId: entity.id,
      x: index * gap,
      y: 0,
      width,
      height,
    }));

  return Promise.resolve(hints);
}
