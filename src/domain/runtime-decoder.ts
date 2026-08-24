import {
  entityId,
  snapshotId,
  type EntityId,
  EdgeEntity,
  GraphEntity,
  GraphSnapshot,
  GraphViewState,
  GroupEntity,
  LayoutHint,
  MermaidSource,
  NodeEntity,
} from "@/domain/graph";
import {
  sceneId,
  storyId,
  type Action,
  type Scene,
  type Story,
  type StoryTransform,
} from "@/domain/story";
import { projectId, type ProjectDocument } from "@/domain/project-document";
import { CURRENT_SCHEMA_VERSION } from "@/domain/schema-version";

type UnknownRecord = Record<string, unknown>;

export class DomainDecodeError extends Error {
  readonly path: string;

  constructor(path: string, expectation: string) {
    super(`Invalid ${path}: ${expectation}.`);
    this.name = "DomainDecodeError";
    this.path = path;
  }
}

function decodeRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DomainDecodeError(path, "expected an object");
  }
  return value as UnknownRecord;
}

function decodeString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new DomainDecodeError(path, "expected a string");
  }
  return value;
}

function decodeNumber(value: unknown, path: string): number {
  if (typeof value !== "number") {
    throw new DomainDecodeError(path, "expected a number");
  }
  return value;
}

function decodeArray<T>(
  value: unknown,
  path: string,
  decodeItem: (item: unknown, itemPath: string) => T,
): readonly T[] {
  if (!Array.isArray(value)) {
    throw new DomainDecodeError(path, "expected an array");
  }
  return value.map((item, index) => decodeItem(item, `${path}[${index}]`));
}

function decodeStringRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = decodeRecord(value, path);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      decodeString(item, `${path}.${key}`),
    ]),
  );
}

function decodeCurrentVersion(record: UnknownRecord, path: string): void {
  if (record.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new DomainDecodeError(
      `${path}.schemaVersion`,
      `expected current schemaVersion ${CURRENT_SCHEMA_VERSION}`,
    );
  }
}

function decodeEntityId(value: unknown, path: string): EntityId {
  return entityId(decodeString(value, path));
}

function decodeEntityIdArray(
  value: unknown,
  path: string,
): readonly EntityId[] {
  return decodeArray(value, path, decodeEntityId);
}

export function decodeGraphEntity(
  value: unknown,
  path = "entity",
): GraphEntity {
  const record = decodeRecord(value, path);
  const kind = decodeString(record.kind, `${path}.kind`);
  const id = decodeEntityId(record.id, `${path}.id`);
  const attributes = decodeStringRecord(
    record.attributes,
    `${path}.attributes`,
  );

  switch (kind) {
    case "node": {
      const entity: NodeEntity = {
        kind,
        id,
        label: decodeString(record.label, `${path}.label`),
        ...(record.groupId !== undefined
          ? { groupId: decodeEntityId(record.groupId, `${path}.groupId`) }
          : {}),
        ...(attributes !== undefined ? { attributes } : {}),
      };
      return entity;
    }
    case "edge": {
      const entity: EdgeEntity = {
        kind,
        id,
        source: decodeEntityId(record.source, `${path}.source`),
        target: decodeEntityId(record.target, `${path}.target`),
        ...(record.label !== undefined
          ? { label: decodeString(record.label, `${path}.label`) }
          : {}),
        ...(attributes !== undefined ? { attributes } : {}),
      };
      return entity;
    }
    case "group": {
      const entity: GroupEntity = {
        kind,
        id,
        label: decodeString(record.label, `${path}.label`),
        memberIds: decodeEntityIdArray(record.memberIds, `${path}.memberIds`),
      };
      return entity;
    }
    default:
      throw new DomainDecodeError(
        `${path}.kind`,
        `unsupported entity kind "${kind}"`,
      );
  }
}

function decodeLayoutHint(value: unknown, path: string): LayoutHint {
  const record = decodeRecord(value, path);
  return {
    entityId: decodeEntityId(record.entityId, `${path}.entityId`),
    x: decodeNumber(record.x, `${path}.x`),
    y: decodeNumber(record.y, `${path}.y`),
    ...(record.width !== undefined
      ? { width: decodeNumber(record.width, `${path}.width`) }
      : {}),
    ...(record.height !== undefined
      ? { height: decodeNumber(record.height, `${path}.height`) }
      : {}),
  };
}

function decodeMermaidSource(value: unknown, path: string): MermaidSource {
  const record = decodeRecord(value, path);
  const importer = decodeRecord(record.importer, `${path}.importer`);
  return {
    diagramType: decodeString(record.diagramType, `${path}.diagramType`),
    text: decodeString(record.text, `${path}.text`),
    importer: {
      importer: decodeString(importer.importer, `${path}.importer.importer`),
      importerVersion: decodeString(
        importer.importerVersion,
        `${path}.importer.importerVersion`,
      ),
      importedAt: decodeString(
        importer.importedAt,
        `${path}.importer.importedAt`,
      ),
    },
  };
}

function decodeGraphViewState(value: unknown, path: string): GraphViewState {
  const record = decodeRecord(value, path);
  return {
    hiddenEntityIds: decodeEntityIdArray(
      record.hiddenEntityIds,
      `${path}.hiddenEntityIds`,
    ),
    groups: decodeArray(record.groups, `${path}.groups`, (group, groupPath) => {
      const groupRecord = decodeRecord(group, groupPath);
      return {
        id: decodeString(groupRecord.id, `${groupPath}.id`),
        label: decodeString(groupRecord.label, `${groupPath}.label`),
        memberIds: decodeEntityIdArray(
          groupRecord.memberIds,
          `${groupPath}.memberIds`,
        ),
      };
    }),
    annotations: decodeArray(
      record.annotations,
      `${path}.annotations`,
      (annotation, annotationPath) => {
        const annotationRecord = decodeRecord(annotation, annotationPath);
        return {
          id: decodeString(annotationRecord.id, `${annotationPath}.id`),
          text: decodeString(annotationRecord.text, `${annotationPath}.text`),
          ...(annotationRecord.entityId !== undefined
            ? {
                entityId: decodeEntityId(
                  annotationRecord.entityId,
                  `${annotationPath}.entityId`,
                ),
              }
            : {}),
        };
      },
    ),
  };
}

export function decodeGraphSnapshot(
  value: unknown,
  path = "snapshot",
): GraphSnapshot {
  const record = decodeRecord(value, path);
  decodeCurrentVersion(record, path);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: snapshotId(decodeString(record.id, `${path}.id`)),
    source: decodeMermaidSource(record.source, `${path}.source`),
    entities: decodeArray(
      record.entities,
      `${path}.entities`,
      decodeGraphEntity,
    ),
    ...(record.layout !== undefined
      ? {
          layout: decodeArray(
            record.layout,
            `${path}.layout`,
            decodeLayoutHint,
          ),
        }
      : {}),
    ...(record.view !== undefined
      ? { view: decodeGraphViewState(record.view, `${path}.view`) }
      : {}),
  };
}

function decodeStoryTransform(value: unknown, path: string): StoryTransform {
  const record = decodeRecord(value, path);
  return {
    translateX: decodeNumber(record.translateX, `${path}.translateX`),
    translateY: decodeNumber(record.translateY, `${path}.translateY`),
    scale: decodeNumber(record.scale, `${path}.scale`),
    rotateDeg: decodeNumber(record.rotateDeg, `${path}.rotateDeg`),
  };
}

export function decodeAction(value: unknown, path = "action"): Action {
  const record = decodeRecord(value, path);
  const type = decodeString(record.type, `${path}.type`);

  switch (type) {
    case "reveal":
    case "hide":
    case "focus":
    case "trace":
      return { type, target: decodeEntityId(record.target, `${path}.target`) };
    case "transform":
      return {
        type,
        target: decodeEntityId(record.target, `${path}.target`),
        to: decodeStoryTransform(record.to, `${path}.to`),
      };
    case "compare": {
      const change = decodeString(record.change, `${path}.change`);
      if (change !== "added" && change !== "removed" && change !== "modified") {
        throw new DomainDecodeError(
          `${path}.change`,
          'expected "added", "removed", or "modified"',
        );
      }
      return {
        type,
        target: decodeEntityId(record.target, `${path}.target`),
        change,
      };
    }
    case "highlight":
      return {
        type,
        target: decodeEntityId(record.target, `${path}.target`),
        ...(record.style !== undefined
          ? { style: decodeString(record.style, `${path}.style`) }
          : {}),
      };
    case "annotate":
      return {
        type,
        target: decodeEntityId(record.target, `${path}.target`),
        text: decodeString(record.text, `${path}.text`),
      };
    case "camera":
      return {
        type,
        focus: decodeEntityIdArray(record.focus, `${path}.focus`),
      };
    default:
      throw new DomainDecodeError(
        `${path}.type`,
        `unsupported action type "${type}"`,
      );
  }
}

function decodeScene(value: unknown, path: string): Scene {
  const record = decodeRecord(value, path);
  return {
    id: sceneId(decodeString(record.id, `${path}.id`)),
    title: decodeString(record.title, `${path}.title`),
    durationMs: decodeNumber(record.durationMs, `${path}.durationMs`),
    actions: decodeArray(record.actions, `${path}.actions`, decodeAction),
  };
}

export function decodeStory(value: unknown, path = "story"): Story {
  const record = decodeRecord(value, path);
  decodeCurrentVersion(record, path);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: storyId(decodeString(record.id, `${path}.id`)),
    title: decodeString(record.title, `${path}.title`),
    snapshotId: snapshotId(
      decodeString(record.snapshotId, `${path}.snapshotId`),
    ),
    scenes: decodeArray(record.scenes, `${path}.scenes`, decodeScene),
  };
}

export function decodeProjectDocument(value: unknown): ProjectDocument {
  const record = decodeRecord(value, "project");
  decodeCurrentVersion(record, "project");
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: projectId(decodeString(record.id, "project.id")),
    name: decodeString(record.name, "project.name"),
    snapshots: decodeArray(
      record.snapshots,
      "project.snapshots",
      decodeGraphSnapshot,
    ),
    stories: decodeArray(record.stories, "project.stories", decodeStory),
  };
}
