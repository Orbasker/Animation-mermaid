import { describe, expect, it } from "vitest";

import { parsePlantuml } from "@/domain/plantuml/parser";

describe("parsePlantuml", () => {
  it("parses a sequence-style diagram: participants and messages", () => {
    const parsed = parsePlantuml(
      [
        "@startuml",
        "actor User as user",
        "participant Web",
        "user -> Web : open",
        "Web --> user : rendered",
        "@enduml",
      ].join("\n"),
    );
    expect(parsed.fatal).toBe(false);
    expect(parsed.elements.map((e) => e.id).sort()).toEqual(["Web", "user"]);
    expect(parsed.relations).toHaveLength(2);
    expect(parsed.relations[0]).toMatchObject({
      source: "user",
      target: "Web",
      label: "open",
      kind: "association",
    });
  });

  it("declares bracket components on first mention in a relation", () => {
    const parsed = parsePlantuml(
      ["@startuml", "[First Component] --> [Second]", "@enduml"].join("\n"),
    );
    expect(parsed.relations).toHaveLength(1);
    const rel = parsed.relations[0];
    const ids = parsed.elements.map((e) => e.id).sort();
    expect(ids).toEqual([rel.source, rel.target].sort());
    expect(parsed.elements.find((e) => e.id === rel.target)?.label).toBe(
      "Second",
    );
  });

  it("nests containers and tracks membership across levels", () => {
    const parsed = parsePlantuml(
      [
        "@startuml",
        "package Outer {",
        "  package Inner {",
        "    [Leaf]",
        "  }",
        "}",
        "@enduml",
      ].join("\n"),
    );
    const outer = parsed.containers.find((c) => c.id === "Outer");
    const inner = parsed.containers.find((c) => c.id === "Inner");
    expect(outer?.memberIds).toEqual(["Inner"]);
    expect(inner?.memberIds).toEqual(["Leaf"]);
    expect(parsed.elements.find((e) => e.id === "Leaf")?.groupId).toBe("Inner");
  });

  it("strips single-line and block comments, keeping quoted apostrophes safe", () => {
    const parsed = parsePlantuml(
      [
        "@startuml",
        "' whole-line comment",
        "class A /' inline block '/",
        "/' multi",
        "line comment '/",
        "class B",
        "@enduml",
      ].join("\n"),
    );
    expect(parsed.elements.map((e) => e.id).sort()).toEqual(["A", "B"]);
  });

  it("reports an unterminated container and an unexpected close", () => {
    const unclosed = parsePlantuml(
      ["@startuml", "package P {", "  class A", "@enduml"].join("\n"),
    );
    expect(
      unclosed.diagnostics.some((d) => d.code === "unclosed-container"),
    ).toBe(true);

    const stray = parsePlantuml(["@startuml", "}", "@enduml"].join("\n"));
    expect(stray.diagnostics.some((d) => d.code === "unexpected-close")).toBe(
      true,
    );
  });

  it("is fatal without an @startuml header", () => {
    const parsed = parsePlantuml("class Foo\nclass Bar");
    expect(parsed.fatal).toBe(true);
    expect(parsed.diagnostics[0].code).toBe("not-plantuml");
  });

  it("is fatal on empty source", () => {
    const parsed = parsePlantuml("   \n\n");
    expect(parsed.fatal).toBe(true);
    expect(parsed.diagnostics[0].code).toBe("empty-source");
  });
});
