import { describe, expect, test } from "bun:test";

import { Type } from "typebox";
import { Value } from "typebox/value";

import type { JsonObject, ReadInput } from "../../src/index.ts";
import { lineRangeSignature } from "../../src/signature/index.ts";
import { generatedInputs } from "./generated.ts";

const names = { path: "file_path", start: "start_line", end: "end_line" } as const;

describe("lineRangeSignature", () => {
  test("maps an inclusive range to offset and limit", () => {
    const signature = lineRangeSignature();
    expect(signature.toInput({ path: "a.txt", start: 3, end: 4 })).toEqual({
      path: "a.txt",
      offset: 3,
      limit: 2,
    });
    expect(signature.toInput({ path: "a.txt", start: 5, end: 5 })).toEqual({
      path: "a.txt",
      offset: 5,
      limit: 1,
    });
    expect(signature.toInput({ path: "a.txt", end: 7 })).toEqual({ path: "a.txt", limit: 7 });
    expect(signature.toInput({ path: "a.txt", start: 2 })).toEqual({ path: "a.txt", offset: 2 });
    expect(signature.toInput({ path: "a.txt" })).toEqual({ path: "a.txt" });
  });

  test("round trip from canonical input", () => {
    const signature = lineRangeSignature({ names });
    const canonical: ReadInput[] = [
      { path: "a.txt" },
      { path: "a.txt", offset: 1 },
      { path: "a.txt", offset: 9 },
      { path: "a.txt", limit: 4 },
      { path: "a.txt", offset: 3, limit: 1 },
      { path: "a.txt", offset: 3, limit: 2_000 },
      { path: "a.txt", offset: Number.MAX_SAFE_INTEGER, limit: 1 },
    ];
    for (const input of canonical) {
      expect(signature.toInput(signature.fromInput(input))).toEqual(input);
    }
    expect(signature.fromInput({ path: "a.txt", offset: 3, limit: 2 })).toEqual({
      file_path: "a.txt",
      start_line: 3,
      end_line: 4,
    });
  });

  test("round trip from model input", () => {
    const signature = lineRangeSignature({ names });
    const models: JsonObject[] = [
      { file_path: "a.txt" },
      { file_path: "a.txt", start_line: 2 },
      { file_path: "a.txt", end_line: 6 },
      { file_path: "a.txt", start_line: 2, end_line: 6 },
    ];
    for (const model of models) {
      expect(signature.fromInput(signature.toInput(model))).toEqual(model);
    }
  });

  test("end < start fails with host names", () => {
    const signature = lineRangeSignature({ names });
    expect(() => signature.toInput({ file_path: "a.txt", start_line: 5, end_line: 4 })).toThrow(
      new TypeError("end_line (4) must not be less than start_line (5)"),
    );
    expect(() => lineRangeSignature().toInput({ path: "a.txt", start: 2, end: 1 })).toThrow(
      "end (1) must not be less than start (2)",
    );
  });

  test("toInput rejects what the schema rejects on generated inputs", () => {
    const signature = lineRangeSignature({ names });
    const schema = Type.Unsafe(signature.schema);
    let rangeOnly = 0;
    for (const input of generatedInputs(["file_path", "start_line", "end_line"], 2_000, 11)) {
      let accepted = true;
      try {
        signature.toInput(input);
      } catch {
        accepted = false;
      }
      const valid = Value.Check(schema, input);
      if (!valid && accepted) throw new Error(`toInput accepts ${JSON.stringify(input)}`);
      if (valid && !accepted) {
        // The one rule a JSON Schema cannot express.
        const record = input as { start_line?: number; end_line: number };
        expect(record.end_line).toBeLessThan(record.start_line ?? 1);
        rangeOnly += 1;
      }
    }
    expect(rangeOnly).toBeGreaterThan(0);
  });
});
