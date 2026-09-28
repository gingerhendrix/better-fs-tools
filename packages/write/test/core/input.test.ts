import { describe, expect, test } from "bun:test";

import {
  defaultWriteLimits,
  parseApplyPatchInput,
  parseEditInput,
  parseWriteInput,
  resolveWriteLimits,
} from "../../src/index.ts";

const limits = defaultWriteLimits;

describe("parseWriteInput", () => {
  test("keeps path and content", () => {
    expect(parseWriteInput({ path: "a.txt", content: "" }, limits)).toEqual({
      tool: "write",
      path: "a.txt",
      content: "",
    });
  });

  test.each([
    ["a non-object", "text"],
    ["an array", []],
    ["an unknown key", { path: "a", content: "", mode: 1 }],
    ["a blank path", { path: "  ", content: "" }],
    ["a path with NUL", { path: "a\0b", content: "" }],
    ["a missing content", { path: "a" }],
    ["a non-string content", { path: "a", content: 1 }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseWriteInput(input, limits)).toThrow(TypeError);
  });
});

describe("parseEditInput", () => {
  test("fills replaceAll", () => {
    expect(parseEditInput({ path: "a", edits: [{ oldText: "x", newText: "" }] }, limits)).toEqual({
      tool: "edit",
      path: "a",
      edits: [{ oldText: "x", newText: "", replaceAll: false }],
    });
  });

  test.each([
    ["no edits", { path: "a", edits: [] }],
    ["an empty oldText", { path: "a", edits: [{ oldText: "", newText: "x" }] }],
    ["a non-string newText", { path: "a", edits: [{ oldText: "x", newText: 1 }] }],
    [
      "a non-boolean replaceAll",
      { path: "a", edits: [{ oldText: "x", newText: "", replaceAll: 1 }] },
    ],
    ["an unknown pair key", { path: "a", edits: [{ oldText: "x", newText: "", old: 1 }] }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseEditInput(input, limits)).toThrow(TypeError);
  });

  test("rejects more than maxEdits pairs", () => {
    const small = resolveWriteLimits({ maxEdits: 1 });
    const edits = [
      { oldText: "a", newText: "b" },
      { oldText: "c", newText: "d" },
    ];
    expect(() => parseEditInput({ path: "a", edits }, small)).toThrow("at most 1");
  });
});

describe("parseApplyPatchInput", () => {
  test("keeps the patch", () => {
    expect(parseApplyPatchInput({ patch: "*** Begin Patch" }, limits)).toEqual({
      tool: "apply_patch",
      patch: "*** Begin Patch",
    });
  });

  test("rejects an empty patch and one over maxPatchBytes", () => {
    expect(() => parseApplyPatchInput({ patch: " " }, limits)).toThrow(TypeError);
    const small = resolveWriteLimits({ maxPatchBytes: 3 });
    expect(() => parseApplyPatchInput({ patch: "abcd" }, small)).toThrow(TypeError);
  });

  test("maxPatchBytes counts UTF-8 bytes, not UTF-16 units", () => {
    const patch = "*** Begin Patch\n*** Add File: /é.txt\n+ééé\n*** End Patch";
    const bytes = new TextEncoder().encode(patch).byteLength;
    expect(patch.length).toBeLessThan(bytes);
    const atUnits = resolveWriteLimits({ maxPatchBytes: patch.length });
    expect(() => parseApplyPatchInput({ patch }, atUnits)).toThrow(
      `patch must be at most ${patch.length} bytes of UTF-8`,
    );
    const atBytes = resolveWriteLimits({ maxPatchBytes: bytes });
    expect(parseApplyPatchInput({ patch }, atBytes).patch).toBe(patch);
    const astral = "😀".repeat(3);
    expect(() =>
      parseApplyPatchInput({ patch: astral }, resolveWriteLimits({ maxPatchBytes: 11 })),
    ).toThrow(TypeError);
    expect(
      parseApplyPatchInput({ patch: astral }, resolveWriteLimits({ maxPatchBytes: 12 })).patch,
    ).toBe(astral);
  });
});
