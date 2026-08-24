import {
  createGraphSnapshot,
  entityId,
  snapshotId,
  type GraphSnapshot,
} from "@/domain/graph";
import {
  createProjectDocument,
  projectId,
  type ProjectDocument,
} from "@/domain/project-document";
import { createStory, sceneId, storyId } from "@/domain/story";

const IMPORTER = {
  importer: "mermaid-flowchart",
  importerVersion: "0.1.0",
  importedAt: "2026-08-18T00:00:00.000Z",
} as const;

/**
 * The "current" architecture: a client talking to an API that fronts a service and a
 * database, with the API and service grouped as a backend. Includes layout hints to prove
 * they stay separate from semantic identity.
 */
export function currentArchitectureSnapshot(): GraphSnapshot {
  return createGraphSnapshot({
    id: snapshotId("snap-current"),
    source: {
      diagramType: "flowchart",
      text: [
        "flowchart TD",
        "  client[Client]",
        "  subgraph backend[Backend]",
        "    api[API Gateway]",
        "    service[Orders Service]",
        "  end",
        "  db[(Database)]",
        "  client --> api",
        "  api --> service",
        "  service --> db",
      ].join("\n"),
      importer: IMPORTER,
    },
    entities: [
      { kind: "node", id: entityId("client"), label: "Client" },
      {
        kind: "node",
        id: entityId("api"),
        label: "API Gateway",
        groupId: entityId("backend"),
      },
      {
        kind: "node",
        id: entityId("service"),
        label: "Orders Service",
        groupId: entityId("backend"),
      },
      {
        kind: "node",
        id: entityId("db"),
        label: "Database",
        attributes: { shape: "cylinder" },
      },
      {
        kind: "group",
        id: entityId("backend"),
        label: "Backend",
        memberIds: [entityId("api"), entityId("service")],
      },
      {
        kind: "edge",
        id: entityId("client->api"),
        source: entityId("client"),
        target: entityId("api"),
      },
      {
        kind: "edge",
        id: entityId("api->service"),
        source: entityId("api"),
        target: entityId("service"),
      },
      {
        kind: "edge",
        id: entityId("service->db"),
        source: entityId("service"),
        target: entityId("db"),
      },
    ],
    layout: [
      { entityId: entityId("client"), x: 0, y: 0 },
      { entityId: entityId("api"), x: 0, y: 120 },
      { entityId: entityId("service"), x: 0, y: 240 },
      { entityId: entityId("db"), x: 0, y: 360 },
    ],
  });
}

/**
 * A "proposed" architecture that adds a cache between the service and the database — a second
 * snapshot (one added node, one added edge, one modified edge) used as a distinct revision.
 */
export function proposedArchitectureSnapshot(): GraphSnapshot {
  return createGraphSnapshot({
    id: snapshotId("snap-proposed"),
    source: {
      diagramType: "flowchart",
      text: [
        "flowchart TD",
        "  client[Client]",
        "  subgraph backend[Backend]",
        "    api[API Gateway]",
        "    service[Orders Service]",
        "  end",
        "  cache[(Cache)]",
        "  db[(Database)]",
        "  client --> api",
        "  api --> service",
        "  service --> cache",
        "  cache --> db",
      ].join("\n"),
      importer: IMPORTER,
    },
    entities: [
      { kind: "node", id: entityId("client"), label: "Client" },
      {
        kind: "node",
        id: entityId("api"),
        label: "API Gateway",
        groupId: entityId("backend"),
      },
      {
        kind: "node",
        id: entityId("service"),
        label: "Orders Service",
        groupId: entityId("backend"),
      },
      {
        kind: "node",
        id: entityId("cache"),
        label: "Cache",
        attributes: { shape: "cylinder" },
      },
      {
        kind: "node",
        id: entityId("db"),
        label: "Database",
        attributes: { shape: "cylinder" },
      },
      {
        kind: "group",
        id: entityId("backend"),
        label: "Backend",
        memberIds: [entityId("api"), entityId("service")],
      },
      {
        kind: "edge",
        id: entityId("client->api"),
        source: entityId("client"),
        target: entityId("api"),
      },
      {
        kind: "edge",
        id: entityId("api->service"),
        source: entityId("api"),
        target: entityId("service"),
      },
      {
        kind: "edge",
        id: entityId("service->db"),
        source: entityId("service"),
        target: entityId("cache"),
      },
      {
        kind: "edge",
        id: entityId("cache->db"),
        source: entityId("cache"),
        target: entityId("db"),
      },
    ],
  });
}

/**
 * A representative, fully-valid project: two snapshots and a story animating the current one.
 * Used by tests and as a reference for downstream work.
 */
export function sampleProjectDocument(): ProjectDocument {
  const current = currentArchitectureSnapshot();
  const proposed = proposedArchitectureSnapshot();

  const story = createStory({
    id: storyId("story-walkthrough"),
    title: "Request walkthrough",
    snapshotId: current.id,
    scenes: [
      {
        id: sceneId("scene-client"),
        title: "Client sends a request",
        durationMs: 1000,
        actions: [
          { type: "reveal", target: entityId("client") },
          { type: "reveal", target: entityId("api") },
          { type: "reveal", target: entityId("client->api") },
          { type: "camera", focus: [entityId("client"), entityId("api")] },
        ],
      },
      {
        id: sceneId("scene-backend"),
        title: "Backend handles it",
        durationMs: 1500,
        actions: [
          { type: "reveal", target: entityId("service") },
          { type: "reveal", target: entityId("api->service") },
          {
            type: "highlight",
            target: entityId("service"),
            style: "active",
          },
          {
            type: "annotate",
            target: entityId("service"),
            text: "Processes the order",
          },
        ],
      },
      {
        id: sceneId("scene-persist"),
        title: "Persist to the database",
        durationMs: 1200,
        actions: [
          { type: "reveal", target: entityId("db") },
          { type: "reveal", target: entityId("service->db") },
          { type: "camera", focus: [] },
        ],
      },
    ],
  });

  return createProjectDocument({
    id: projectId("proj-sample"),
    name: "Sample architecture story",
    snapshots: [current, proposed],
    stories: [story],
  });
}
