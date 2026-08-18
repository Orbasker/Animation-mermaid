import { describe, expect, it } from "vitest";

import {
  CURRENT_SCHEMA_VERSION,
  assertCurrentSchemaVersion,
  isCurrentSchemaVersion,
  isSupportedSchemaVersion,
  migrateDocument,
} from "@/domain/schema-version";

describe("schema version", () => {
  it("recognizes the current version", () => {
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

  it("refuses to migrate an unsupported version", () => {
    expect(() => migrateDocument({ schemaVersion: 99 })).toThrow(
      /unsupported schemaVersion/i,
    );
  });
});
