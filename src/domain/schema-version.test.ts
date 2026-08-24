import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  assertCurrentSchemaVersion,
  isCurrentSchemaVersion,
  isSupportedSchemaVersion,
  migrateDocument,
} from "@/domain/schema-version";
import {
  currentArchitectureSnapshot,
  sampleProjectDocument,
} from "@/domain/fixtures";

describe("schema version", () => {
  const legacySnapshot = () => ({
    ...currentArchitectureSnapshot(),
    schemaVersion: 1,
  });
  const legacyStory = () => ({
    ...sampleProjectDocument().stories[0],
    schemaVersion: 1,
  });
  const legacyDocument = () => ({
    ...sampleProjectDocument(),
    schemaVersion: 1,
    snapshots: sampleProjectDocument().snapshots.map((snapshot) => ({
      ...snapshot,
      schemaVersion: 1,
    })),
    stories: [legacyStory()],
  });

  it("recognizes the current version", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    expect(isCurrentSchemaVersion(CURRENT_SCHEMA_VERSION)).toBe(true);
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION)).toBe(true);
  });

  it("rejects unknown or missing versions", () => {
    expect(isCurrentSchemaVersion(0)).toBe(false);
    expect(isCurrentSchemaVersion(CURRENT_SCHEMA_VERSION + 1)).toBe(false);
    expect(isCurrentSchemaVersion(undefined)).toBe(false);
    expect(isCurrentSchemaVersion("1")).toBe(false);
    expect(isSupportedSchemaVersion("1")).toBe(false);
  });

  it("asserts on documents at the current version", () => {
    expect(() =>
      assertCurrentSchemaVersion({ schemaVersion: CURRENT_SCHEMA_VERSION }),
    ).not.toThrow();
  });

  it("throws for documents at an unsupported version", () => {
    expect(() => assertCurrentSchemaVersion({ schemaVersion: 99 })).toThrow(
      /Unsupported schemaVersion: 99/,
    );
    expect(() => assertCurrentSchemaVersion({})).toThrow(
      /Unsupported schemaVersion/,
    );
  });

  it("passes a current-version document through migration untouched", () => {
    const document = { schemaVersion: CURRENT_SCHEMA_VERSION, name: "x" };
    expect(migrateDocument(document)).toEqual(document);
  });

  it.each([
    ["GraphSnapshot", currentArchitectureSnapshot()],
    ["Story", sampleProjectDocument().stories[0]],
    ["ProjectDocument", sampleProjectDocument()],
  ])("passes a current %s through migration untouched", (_, artifact) => {
    expect(migrateDocument(artifact)).toEqual(artifact);
  });

  it("migrates version 1 containers and nested documents to version 2", () => {
    const migrated = migrateDocument(legacyDocument());
    expect(migrated.schemaVersion).toBe(2);
    expect(
      (migrated.snapshots as { schemaVersion: number }[]).every(
        (snapshot) => snapshot.schemaVersion === 2,
      ),
    ).toBe(true);
    expect(
      (migrated.stories as { schemaVersion: number }[]).every(
        (story) => story.schemaVersion === 2,
      ),
    ).toBe(true);
  });

  it.each([
    ["populated GraphSnapshot", legacySnapshot()],
    ["empty GraphSnapshot", { ...legacySnapshot(), entities: [], layout: [] }],
    ["populated Story", legacyStory()],
    ["empty Story", { ...legacyStory(), scenes: [] }],
    [
      "empty ProjectDocument",
      {
        ...legacyDocument(),
        snapshots: [],
        stories: [],
      },
    ],
  ])("migrates a standalone or empty v1 %s", (_, artifact) => {
    const migrated = migrateDocument(artifact);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrateDocument(migrated)).toEqual(migrated);
  });

  it.each([
    ["missing", undefined],
    ["mixed", 2],
    ["unsupported", 99],
  ])("rejects %s nested versions during version-1 migration", (_, version) => {
    const document = legacyDocument();
    const nested = { ...document.stories[0] } as {
      schemaVersion?: number;
      id: string;
    };
    if (version === undefined) {
      delete nested.schemaVersion;
    } else {
      nested.schemaVersion = version;
    }

    expect(() => migrateDocument({ ...document, stories: [nested] })).toThrow(
      /stories\[0\].*schemaVersion 1/i,
    );
  });

  it.each(["focus", "trace", "transform", "compare"])(
    "rejects the v2-only %s action in a v1 Story",
    (type) => {
      const story = legacyStory();
      const action =
        type === "transform"
          ? {
              type,
              target: "client",
              to: { translateX: 0, translateY: 0, scale: 1, rotateDeg: 0 },
            }
          : type === "compare"
            ? { type, target: "client", change: "modified" }
            : { type, target: "client" };
      const invalid = {
        ...story,
        scenes: [
          {
            ...story.scenes[0],
            actions: [action],
          },
        ],
      };

      expect(() => migrateDocument(invalid)).toThrow(
        new RegExp(`${type}.*schemaVersion 1`, "i"),
      );
    },
  );

  it.each([
    ["GraphSnapshot", { ...legacySnapshot(), entities: undefined }],
    ["Story", { ...legacyStory(), scenes: undefined }],
  ])("rejects a malformed v1 %s before relabeling", (_, artifact) => {
    expect(() => migrateDocument(artifact)).toThrow(/cannot migrate.*array/i);
  });

  it("is idempotent when migration is repeated", () => {
    const migrated = migrateDocument(legacyDocument());
    expect(migrateDocument(migrated)).toEqual(migrated);
  });

  it("refuses to migrate an unsupported version", () => {
    expect(() => migrateDocument({ schemaVersion: 99 })).toThrow(
      /unsupported schemaVersion/i,
    );
  });
});
