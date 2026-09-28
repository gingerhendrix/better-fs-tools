import { describe, expect, test } from "bun:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { defaultReadSignature, lineRangeSignature } from "../../src/signature/index.ts";
import { generatedInputs } from "./generated.ts";

const names = { path: "file_path", offset: "start_line", limit: "max_lines" } as const;

describe("defaultReadSignature with names", () => {
  test("the schema uses the host names in the canonical order", () => {
    const signature = defaultReadSignature({ names });
    expect(Object.keys(signature.schema.properties as object)).toEqual([
      "file_path",
      "start_line",
      "max_lines",
    ]);
    expect(signature.schema.required).toEqual(["file_path"]);
    expect(signature.description).toContain("`start_line`");
    expect(signature.description).not.toContain("`offset`");
  });

  test("a partial rename keeps the other canonical names", () => {
    const signature = defaultReadSignature({ names: { path: "file" } });
    expect(Object.keys(signature.schema.properties as object)).toEqual(["file", "offset", "limit"]);
    expect(signature.toInput({ file: "a.txt", limit: 2 })).toEqual({ path: "a.txt", limit: 2 });
  });

  test("toInput and fromInput map names both ways", () => {
    const signature = defaultReadSignature({ names });
    expect(signature.toInput({ file_path: "a.txt", start_line: 3, max_lines: 2 })).toEqual({
      path: "a.txt",
      offset: 3,
      limit: 2,
    });
    expect(signature.fromInput({ path: "a.txt", offset: 3, limit: 2 })).toEqual({
      file_path: "a.txt",
      start_line: 3,
      max_lines: 2,
    });
    expect(signature.fromInput({ path: "a.txt" })).toEqual({ file_path: "a.txt" });
  });

  test("toInput errors name host parameters and refuse canonical names", () => {
    const signature = defaultReadSignature({ names });
    expect(() => signature.toInput({ path: "a.txt" })).toThrow(
      "Unknown read input key: path. Expected file_path, start_line, max_lines",
    );
    expect(() => signature.toInput({ file_path: "a.txt", start_line: 0 })).toThrow(
      "start_line must be a positive integer",
    );
    expect(() => signature.toInput({ start_line: 1 })).toThrow("file_path is required");
  });

  test("param gives the host name of each canonical parameter", () => {
    const renamed = defaultReadSignature({ names });
    expect(renamed.param("path")).toBe("file_path");
    expect(renamed.param("offset")).toBe("start_line");
    expect(renamed.param("limit")).toBe("max_lines");
    expect(defaultReadSignature().param("offset")).toBe("offset");
    // A line range has no parameter that holds a line count.
    const range = lineRangeSignature({ names: { path: "file", start: "from" } });
    expect([range.param("path"), range.param("offset"), range.param("limit")]).toEqual([
      "file",
      "from",
      "",
    ]);
  });

  test("bad names are refused when the signature is built", () => {
    expect(() => defaultReadSignature({ names: { path: "" } })).toThrow(TypeError);
    expect(() => defaultReadSignature({ names: { offset: "limit" } })).toThrow(TypeError);
    expect(() => defaultReadSignature({ names: { line: "x" } as never })).toThrow(TypeError);
    expect(() => defaultReadSignature(null as never)).toThrow(TypeError);
  });

  test("toInput rejects exactly what the schema rejects on generated inputs", () => {
    const signature = defaultReadSignature({ names });
    const schema = Type.Unsafe(signature.schema);
    for (const input of generatedInputs(
      ["file_path", "start_line", "max_lines", "path"],
      2_000,
      7,
    )) {
      let accepted = true;
      try {
        signature.toInput(input);
      } catch {
        accepted = false;
      }
      if (accepted !== Value.Check(schema, input)) {
        throw new Error(`toInput and the schema disagree on ${JSON.stringify(input)}`);
      }
    }
  });
});
