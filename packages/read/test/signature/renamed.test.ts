import { describe, expect, test } from "bun:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { renamedSignature } from "../../src/signature/index.ts";
import { generatedInputs } from "./generated.ts";

const names = { path: "file_path", offset: "start_line", limit: "max_lines" } as const;

describe("renamedSignature", () => {
  test("the schema uses the host names in the canonical order", () => {
    const signature = renamedSignature({ names });
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
    const signature = renamedSignature({ names: { path: "file" } });
    expect(Object.keys(signature.schema.properties as object)).toEqual(["file", "offset", "limit"]);
    expect(signature.toRead({ file: "a.txt", limit: 2 })).toEqual({ path: "a.txt", limit: 2 });
  });

  test("toRead and fromRead map names both ways", () => {
    const signature = renamedSignature({ names });
    expect(signature.toRead({ file_path: "a.txt", start_line: 3, max_lines: 2 })).toEqual({
      path: "a.txt",
      offset: 3,
      limit: 2,
    });
    expect(signature.fromRead({ path: "a.txt", offset: 3, limit: 2 })).toEqual({
      file_path: "a.txt",
      start_line: 3,
      max_lines: 2,
    });
    expect(signature.fromRead({ path: "a.txt" })).toEqual({ file_path: "a.txt" });
  });

  test("toRead errors name host parameters and refuse canonical names", () => {
    const signature = renamedSignature({ names });
    expect(() => signature.toRead({ path: "a.txt" })).toThrow(
      "Unknown read input key: path. Expected file_path, start_line, max_lines",
    );
    expect(() => signature.toRead({ file_path: "a.txt", start_line: 0 })).toThrow(
      "start_line must be a positive integer",
    );
    expect(() => signature.toRead({ start_line: 1 })).toThrow("file_path is required");
  });

  test("bad names are refused when the signature is built", () => {
    expect(() => renamedSignature({ names: { path: "" } })).toThrow(TypeError);
    expect(() => renamedSignature({ names: { offset: "limit" } })).toThrow(TypeError);
    expect(() => renamedSignature({ names: { line: "x" } as never })).toThrow(TypeError);
    expect(() => renamedSignature(null as never)).toThrow(TypeError);
  });

  test("toRead rejects exactly what the schema rejects on generated inputs", () => {
    const signature = renamedSignature({ names });
    const schema = Type.Unsafe(signature.schema);
    for (const input of generatedInputs(
      ["file_path", "start_line", "max_lines", "path"],
      2_000,
      7,
    )) {
      let accepted = true;
      try {
        signature.toRead(input);
      } catch {
        accepted = false;
      }
      if (accepted !== Value.Check(schema, input)) {
        throw new Error(`toRead and the schema disagree on ${JSON.stringify(input)}`);
      }
    }
  });
});
