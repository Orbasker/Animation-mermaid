import {
  createGraphSnapshot,
  entityId,
  snapshotId,
  type EntityId,
  type GraphSnapshot,
  type GraphViewState,
  type LayoutHint,
} from "@/domain/graph";

export type EditorTransaction =
  | {
      readonly type: "move";
      readonly entityId: EntityId;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: "set-hidden";
      readonly entityIds: readonly EntityId[];
      readonly hidden: boolean;
    }
  | {
      readonly type: "group";
      readonly id: string;
      readonly label: string;
      readonly memberIds: readonly EntityId[];
    }
  | {
      readonly type: "annotate";
      readonly id: string;
      readonly text: string;
      readonly entityId?: EntityId;
    };

export interface EditorHistory {
  readonly past: readonly GraphSnapshot[];
  readonly present: GraphSnapshot;
  readonly future: readonly GraphSnapshot[];
}

export function applyEditorTransaction(
  snapshot: GraphSnapshot,
  transaction: EditorTransaction,
): GraphSnapshot {
  const view: GraphViewState = snapshot.view ?? {
    hiddenEntityIds: [],
    groups: [],
    annotations: [],
  };

  switch (transaction.type) {
    case "move": {
      const previous = snapshot.layout ?? [];
      const index = previous.findIndex(
        (hint) => hint.entityId === transaction.entityId,
      );
      const nextHint: LayoutHint = {
        ...(index >= 0 ? previous[index] : { entityId: transaction.entityId }),
        x: transaction.x,
        y: transaction.y,
      };
      const layout =
        index >= 0
          ? previous.map((hint, hintIndex) =>
              hintIndex === index ? nextHint : hint,
            )
          : [...previous, nextHint];
      return { ...snapshot, layout };
    }
    case "set-hidden": {
      const hidden = new Set(view.hiddenEntityIds);
      for (const id of transaction.entityIds) {
        if (transaction.hidden) hidden.add(id);
        else hidden.delete(id);
      }
      return {
        ...snapshot,
        view: { ...view, hiddenEntityIds: [...hidden] },
      };
    }
    case "group": {
      const group = {
        id: transaction.id,
        label: transaction.label,
        memberIds: [...new Set(transaction.memberIds)],
      };
      const existingIndex = view.groups.findIndex(
        (item) => item.id === group.id,
      );
      const groups =
        existingIndex >= 0
          ? view.groups.map((item, index) =>
              index === existingIndex ? group : item,
            )
          : [...view.groups, group];
      return { ...snapshot, view: { ...view, groups } };
    }
    case "annotate": {
      const annotation = {
        id: transaction.id,
        text: transaction.text,
        ...(transaction.entityId !== undefined
          ? { entityId: transaction.entityId }
          : {}),
      };
      const withoutCurrent = view.annotations.filter(
        (item) => item.id !== annotation.id,
      );
      const annotations = transaction.text.trim()
        ? [...withoutCurrent, annotation]
        : withoutCurrent;
      return { ...snapshot, view: { ...view, annotations } };
    }
  }
}

export function createEditorHistory(snapshot: GraphSnapshot): EditorHistory {
  return { past: [], present: snapshot, future: [] };
}

export function commitEditorTransaction(
  history: EditorHistory,
  transaction: EditorTransaction,
): EditorHistory {
  return {
    past: [...history.past, history.present],
    present: applyEditorTransaction(history.present, transaction),
    future: [],
  };
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  const [next, ...future] = history.future;
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future,
  };
}

export function reconcileImportedSnapshot(
  previous: GraphSnapshot,
  imported: GraphSnapshot,
): GraphSnapshot {
  const entityIds = new Set(imported.entities.map((entity) => entity.id));
  const previousLayout = new Map(
    (previous.layout ?? [])
      .filter((hint) => entityIds.has(hint.entityId))
      .map((hint) => [hint.entityId, hint]),
  );
  const importedLayout = imported.layout ?? [];
  const layout = importedLayout.map(
    (hint) => previousLayout.get(hint.entityId) ?? hint,
  );
  const layoutIds = new Set(layout.map((hint) => hint.entityId));
  for (const hint of previousLayout.values()) {
    if (!layoutIds.has(hint.entityId)) layout.push(hint);
  }

  const previousView = previous.view;
  const view = previousView
    ? {
        hiddenEntityIds: previousView.hiddenEntityIds.filter((id) =>
          entityIds.has(id),
        ),
        groups: previousView.groups
          .map((group) => ({
            ...group,
            memberIds: group.memberIds.filter((id) => entityIds.has(id)),
          }))
          .filter((group) => group.memberIds.length > 0),
        annotations: previousView.annotations.filter(
          (annotation) =>
            annotation.entityId === undefined ||
            entityIds.has(annotation.entityId),
        ),
      }
    : undefined;

  return {
    ...imported,
    ...(layout.length > 0 ? { layout } : {}),
    ...(view !== undefined ? { view } : {}),
  };
}

export function createStressSnapshot(nodeCount: number): GraphSnapshot {
  const count = Math.max(0, Math.floor(nodeCount));
  const nodes = Array.from({ length: count }, (_, index) => ({
    kind: "node" as const,
    id: entityId(`service-${index + 1}`),
    label: `Service ${index + 1}`,
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    kind: "edge" as const,
    id: entityId(`${nodes[index].id}->${node.id}`),
    source: nodes[index].id,
    target: node.id,
  }));
  const layout = nodes.map((node, index) => ({
    entityId: node.id,
    x: (index % 20) * 190,
    y: Math.floor(index / 20) * 110,
    width: 150,
    height: 54,
  }));
  const lines = [
    "flowchart LR",
    ...nodes.map((node) => `  ${node.id}[${node.label}]`),
    ...edges.map((edge) => `  ${edge.source} --> ${edge.target}`),
  ];

  return createGraphSnapshot({
    id: snapshotId(`stress-${count}`),
    source: {
      diagramType: "flowchart",
      text: lines.join("\n"),
      importer: {
        importer: "stress-fixture",
        importerVersion: "1.0.0",
        importedAt: "2026-08-18T00:00:00.000Z",
      },
    },
    entities: [...nodes, ...edges],
    layout,
  });
}
