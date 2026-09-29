import { describe, expect, test } from "bun:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { defaultReadSignature } from "../../src/signature/index.ts";
import type { ReadSignature } from "../../src/signature/index.ts";
import { generatedInputs } from "./generated.ts";

// Strict grammar engines may refuse lookaheads, so the default pattern must not use one.
const LOOKAHEAD_PATH_PATTERN = "^(?=[^\\u0000]*$)[\\s\\S]*[^\\s\\u0000][\\s\\S]*$";

const PATH_TABLE = [
  "",
  " ",
  "\t\n",
  "\u00a0",
  "\u2028",
  "\u0000",
  "a\u0000b",
  " \u0000 ",
  "a",
  "a.txt",
  "/abs/path/file.ts",
  "dir/a b.txt",
  " leading",
  "trailing ",
  "  both  ",
  "caf\u00e9/\u6587\u4ef6.md",
  "\ud83d\ude00.txt",
  "\ud83d",
  "line\nbreak",
];

function schemaAccepts(signature: ReadSignature, input: unknown): boolean {
  return Value.Check(Type.Unsafe(signature.schema), input);
}

function toReadAccepts(signature: ReadSignature, input: unknown): boolean {
  try {
    signature.toInput(input);
    return true;
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return false;
  }
}

describe("defaultReadSignature", () => {
  test("the path pattern has no lookaround and accepts what the lookahead pattern accepted", () => {
    const pattern = (
      defaultReadSignature().schema.properties as Record<string, { pattern: string }>
    ).path!.pattern;
    expect(pattern).not.toMatch(/\(\?[=!<]/u);
    for (const flags of ["u", ""]) {
      const next = new RegExp(pattern, flags);
      const old = new RegExp(LOOKAHEAD_PATH_PATTERN, flags);
      for (const value of PATH_TABLE) {
        expect({ value, flags, accepts: next.test(value) }).toEqual({
          value,
          flags,
          accepts: old.test(value),
        });
      }
    }
    expect(new RegExp(pattern, "u").test("dir/a b.txt")).toBe(true);
    expect(new RegExp(pattern, "u").test(" \t")).toBe(false);
    expect(new RegExp(pattern, "u").test("a\u0000b")).toBe(false);
  });
  test("schema snapshot", () => {
    const signature = defaultReadSignature();
    expect(signature.name).toBe("read");
    expect(signature.schema).toMatchSnapshot();
    expect(signature.description).toMatchSnapshot();
  });

  test("docs options replace the name, description, and parameter descriptions", () => {
    const signature = defaultReadSignature({
      name: "read_file",
      description: "Read one file.",
      describe: { path: "Where to read." },
    });
    const properties = signature.schema.properties as Record<string, { description: string }>;
    expect(signature.name).toBe("read_file");
    expect(signature.description).toBe("Read one file.");
    expect(properties.path?.description).toBe("Where to read.");
    expect(properties.offset?.description).toMatch(/one-based/iu);
  });

  test("the schema and the signature are frozen", () => {
    const signature = defaultReadSignature();
    expect(Object.isFrozen(signature)).toBe(true);
    expect(Object.isFrozen(signature.schema)).toBe(true);
    expect(Object.isFrozen(signature.schema.properties)).toBe(true);
  });

  test("toInput and fromInput are the identity on canonical input", () => {
    const signature = defaultReadSignature();
    for (const input of [
      { path: "a.txt" },
      { path: "a.txt", offset: 2 },
      { path: "a.txt", limit: 3 },
      { path: "a.txt", offset: 2, limit: 3 },
    ]) {
      expect(signature.toInput(input)).toEqual(input);
      expect(signature.fromInput(input)).toEqual(input);
    }
  });

  test("toInput refuses aliases, strings for numbers, zero, fractions, and blank paths", () => {
    const signature = defaultReadSignature();
    const rejected: unknown[] = [
      { file_path: "a.txt" },
      { path: "a.txt", line: 2 },
      { path: "a.txt", offset: "2" },
      { path: "a.txt", offset: 0 },
      { path: "a.txt", limit: -1 },
      { path: "a.txt", offset: 1.5 },
      { path: "a.txt", limit: Number.MAX_SAFE_INTEGER + 1 },
      { path: "" },
      { path: "  " },
      { path: "a\0.txt" },
      { path: 7 },
      {},
      "a.txt",
      null,
      ["a.txt"],
    ];
    for (const input of rejected) expect(() => signature.toInput(input)).toThrow(TypeError);
  });

  test("toInput error messages name the parameter", () => {
    const signature = defaultReadSignature();
    expect(() => signature.toInput({})).toThrow("path is required");
    expect(() => signature.toInput({ path: "a", offset: 0 })).toThrow(
      "offset must be a positive integer",
    );
    expect(() => signature.toInput({ path: "a", extra: 1 })).toThrow(
      "Unknown read input key: extra. Expected path, offset, limit",
    );
  });

  test("toInput rejects exactly what the schema rejects on generated inputs", () => {
    const signature = defaultReadSignature();
    const inputs = generatedInputs(["path", "offset", "limit"], 3_000);
    let accepted = 0;
    for (const input of inputs) {
      const schema = schemaAccepts(signature, input);
      if (toReadAccepts(signature, input) !== schema) {
        throw new Error(`schema ${schema ? "accepts" : "rejects"} ${JSON.stringify(input)}`);
      }
      if (schema) accepted += 1;
    }
    expect(accepted).toBeGreaterThan(300);
    expect(inputs.length - accepted).toBeGreaterThan(300);
  });
});
