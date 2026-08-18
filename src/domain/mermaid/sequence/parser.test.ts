import { describe, expect, it } from "vitest";

import {
  ACCEPTANCE_SEQUENCE,
  HOSTILE_SEQUENCE,
  RICH_SEQUENCE,
} from "@/domain/mermaid/sequence/fixtures";
import { parseSequence } from "@/domain/mermaid/sequence/parser";

describe("parseSequence", () => {
  it("parses participants (with aliases) and ordered messages", () => {
    const parsed = parseSequence(ACCEPTANCE_SEQUENCE);
    expect(parsed.fatal).toBe(false);
    expect(parsed.participants.map((p) => p.id)).toEqual([
      "client",
      "api",
      "service",
      "db",
    ]);
    expect(parsed.participants[1]).toEqual({
      id: "api",
      label: "API Gateway",
      role: "participant",
    });
    expect(parsed.messages.map((m) => `${m.source}->${m.target}`)).toEqual([
      "client->api",
      "api->service",
      "service->db",
      "db->service",
      "service->api",
      "api->client",
    ]);
    expect(parsed.messages[0]).toMatchObject({
      label: "Place order",
      line: "solid",
      arrow: "normal",
    });
    expect(parsed.messages[3]).toMatchObject({ line: "dotted" });
  });

  it("preserves message order across identical participant pairs", () => {
    const parsed = parseSequence(
      ["sequenceDiagram", "A->>B: one", "A->>B: two"].join("\n"),
    );
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages.map((m) => m.label)).toEqual(["one", "two"]);
  });

  it("creates implicit participants on first mention and keeps actor/async/lost messages", () => {
    const parsed = parseSequence(RICH_SEQUENCE);
    expect(parsed.fatal).toBe(false);
    // `user` (actor) + `web` explicit, `worker` implicit from a message.
    expect(parsed.participants.map((p) => p.id).sort()).toEqual([
      "user",
      "web",
      "worker",
    ]);
    expect(parsed.participants.find((p) => p.id === "user")?.role).toBe(
      "actor",
    );
    // The message inside the `loop` block still imports.
    expect(
      parsed.messages.some(
        (m) =>
          m.source === "worker" && m.target === "web" && m.arrow === "circle",
      ),
    ).toBe(true);
    // The lost message (`--x`) is dotted + cross.
    expect(
      parsed.messages.some((m) => m.arrow === "cross" && m.line === "dotted"),
    ).toBe(true);
  });

  it("reports blocks, notes, activations, and autonumber as non-fatal diagnostics", () => {
    const parsed = parseSequence(RICH_SEQUENCE);
    const codes = new Set(parsed.diagnostics.map((d) => d.code));
    expect(codes).toContain("block-ignored");
    expect(codes).toContain("note-ignored");
    expect(codes).toContain("activation-ignored");
    expect(codes).toContain("autonumber-ignored");
    expect(parsed.diagnostics.every((d) => d.severity !== "error")).toBe(true);
  });

  it("never treats an arrow inside a label as the connector", () => {
    const parsed = parseSequence(
      ["sequenceDiagram", "A->>B: retry then A-->>B later"].join("\n"),
    );
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      source: "A",
      target: "B",
      label: "retry then A-->>B later",
    });
  });

  it("strips activation markers from message targets", () => {
    const parsed = parseSequence(
      ["sequenceDiagram", "A->>+B: go", "B-->>-A: done"].join("\n"),
    );
    expect(parsed.messages.map((m) => `${m.source}->${m.target}`)).toEqual([
      "A->B",
      "B->A",
    ]);
  });

  it("is fatal for non-sequence and empty source", () => {
    const notSeq = parseSequence("flowchart TD\n  a --> b");
    expect(notSeq.fatal).toBe(true);
    expect(notSeq.diagnostics[0].code).toBe("not-a-sequence");

    const empty = parseSequence("   \n\n");
    expect(empty.fatal).toBe(true);
    expect(empty.diagnostics[0].code).toBe("empty-source");
  });

  it("sanitizes unsafe labels and reports an init directive without executing it", () => {
    const parsed = parseSequence(HOSTILE_SEQUENCE);
    expect(parsed.fatal).toBe(false);
    const codes = parsed.diagnostics.map((d) => d.code);
    expect(codes).toContain("directive-ignored");
    expect(codes).toContain("label-sanitized");
    // The safe message still imports; the script markup is gone.
    const message = parsed.messages.find((m) => m.source === "a");
    expect(message?.label).not.toMatch(/<|onerror|script/i);
    const login = parsed.participants.find((p) => p.id === "a");
    expect(login?.label).not.toMatch(/<|script/i);
  });
});
