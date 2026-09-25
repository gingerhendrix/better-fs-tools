import { describe, expect, test } from "bun:test";

import { defaultLimits, parseReadInput, textOf } from "../../src/index.ts";
import { expectFailure, harness } from "../helpers.ts";

describe("parseReadInput", () => {
  test("fills defaults and clamps the limit", () => {
    expect(parseReadInput({ path: "a.ts" }, defaultLimits)).toEqual({
      path: "a.ts",
      offset: 1,
      limit: defaultLimits.maxLines,
      ranged: false,
    });
    expect(parseReadInput({ path: "a.ts", limit: 10_000 }, defaultLimits).limit).toBe(
      defaultLimits.maxLines,
    );
  });

  test("marks a request ranged when offset or limit is set", () => {
    expect(parseReadInput({ path: "a.ts", offset: 3 }, defaultLimits).ranged).toBe(true);
    expect(parseReadInput({ path: "a.ts", limit: 3 }, defaultLimits).ranged).toBe(true);
  });

  test("rejects aliases, strings, and non-positive integers", () => {
    const parse = (input: unknown) => () => parseReadInput(input, defaultLimits);
    expect(parse({ file_path: "a.ts" })).toThrow(TypeError);
    expect(parse({ path: "a.ts", start_line: 3 })).toThrow("Unknown read input key: start_line");
    expect(parse({ path: "a.ts", limit: "50" })).toThrow(TypeError);
    expect(parse({ path: "a.ts", offset: 0 })).toThrow(TypeError);
    expect(parse({ path: "a.ts", offset: 1.5 })).toThrow(TypeError);
    expect(parse({ path: "a.ts", limit: Number.MAX_SAFE_INTEGER + 1 })).toThrow(TypeError);
    expect(parse({ path: "" })).toThrow(TypeError);
    expect(parse({ path: "   " })).toThrow(TypeError);
    expect(parse({ path: "a\u0000b" })).toThrow(TypeError);
    expect(parse("a.ts")).toThrow(TypeError);
    expect(parse(["a.ts"])).toThrow(TypeError);
    expect(parse(null)).toThrow(TypeError);
  });
});

describe("invalid input through the tool", () => {
  test("becomes a formatted INVALID_INPUT result", async () => {
    const { read } = harness({ files: { "/a.txt": "x\n" } });
    const result = expectFailure(await read({ path: "/a.txt", offset: -2 }), "INVALID_INPUT");
    expect(result.request).toBeNull();
    expect(result.notes[0]?.data).toEqual({ path: "/a.txt" });
    expect(textOf(result)).toBe(
      "[read:invalid-input] The read input was rejected: offset must be a positive safe integer",
    );
  });

  test("an alias key is refused, not repaired", async () => {
    const { read } = harness({ files: { "/a.txt": "x\n" } });
    const result = expectFailure(await read({ file_path: "/a.txt" } as never), "INVALID_INPUT");
    expect(result.notes[0]?.data).toBeUndefined();
  });

  test("the filesystem is never built for invalid input", async () => {
    let built = 0;
    const { fs } = harness({ files: { "/a.txt": "x\n" } });
    const { createReadTool } = await import("../../src/index.ts");
    const read = createReadTool({
      fs: () => {
        built += 1;
        return fs;
      },
    });
    await read({ path: "" });
    expect(built).toBe(0);
  });
});
