import { describe, expect, test } from "bun:test";

import { addStep, emptyMetrics, errorKind, totalErrors } from "../src/metrics.ts";

describe("addStep", () => {
  test("counts calls, result error codes, notes, and input size", () => {
    const m = emptyMetrics();
    addStep(m, [
      { type: "tool-call", toolName: "edit", input: { path: "a.ts" } },
      {
        type: "tool-result",
        toolName: "edit",
        output: {
          status: "error",
          error: { code: "NO_MATCH" },
          notes: [{ code: "repeated-miss" }],
        },
      },
      { type: "tool-call", toolName: "read", input: { path: "b.ts" } },
      {
        type: "tool-result",
        toolName: "read",
        output: { status: "error", code: "NOT_FOUND", notes: [] },
      },
      {
        type: "tool-error",
        toolName: "apply_patch",
        error: "AI_JSONParseError: JSON parsing failed",
      },
    ]);
    expect(m.steps).toBe(1);
    expect(m.toolCalls).toEqual({ edit: 1, read: 1 });
    expect(m.toolErrors).toEqual({
      "edit:NO_MATCH": 1,
      "read:NOT_FOUND": 1,
      "apply_patch:bad-json": 1,
    });
    expect(m.notes).toEqual({ "edit:repeated-miss": 1 });
    expect(m.toolInputChars).toBe(JSON.stringify({ path: "a.ts" }).length * 2);
    expect(totalErrors(m)).toBe(3);
  });
});

describe("errorKind", () => {
  test("names schema, unknown tool, and other errors", () => {
    expect(errorKind(new Error("Type validation failed"))).toBe("schema");
    expect(errorKind("AI_NoSuchToolError: no tool bash")).toBe("unknown-tool");
    expect(errorKind(new Error("boom"))).toBe("thrown");
  });
});
