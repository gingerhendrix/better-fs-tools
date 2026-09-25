import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool } from "../../src/index.ts";
import { expectOk } from "../helpers.ts";

const fs = memoryFileSystem({ files: { "/a.txt": "one\n" } });

describe("createReadTool", () => {
  test("needs only fs", async () => {
    expectOk(await createReadTool({ fs })({ path: "/a.txt" }));
  });

  test("validates dependencies synchronously at creation", () => {
    expect(() => createReadTool({} as never)).toThrow("fs must be a FileSystem");
    expect(() => createReadTool({ fs: {} as never })).toThrow(TypeError);
    expect(() => createReadTool({ fs, classifiers: [] })).toThrow(
      "classifiers must be a non-empty array",
    );
    expect(() => createReadTool({ fs, limits: { maxLines: 0 } })).toThrow(TypeError);
    expect(() => createReadTool({ fs, messages: { nope: () => "" } as never })).toThrow(TypeError);
    expect(() => createReadTool({ fs, formatter: {} as never })).toThrow(TypeError);
    expect(() => createReadTool({ fs, clock: 1 as never })).toThrow(TypeError);
    expect(() => createReadTool(null as never)).toThrow(TypeError);
  });

  test("an unknown dependency key throws TypeError", () => {
    for (const key of ["input", "recovery", "resolve", "suggest", "authorize", "hooks"]) {
      expect(() => createReadTool({ fs, [key]: null } as never)).toThrow(
        `Unknown read tool dependency: ${key}`,
      );
    }
  });

  test("rejects a context that is not an object", async () => {
    const read = createReadTool({ fs });
    await expect(read({ path: "/a.txt" }, "ctx" as never)).rejects.toThrow(TypeError);
    await expect(read({ path: "/a.txt" }, null as never)).rejects.toThrow(TypeError);
  });

  test("accepts a context with a signal and a call id", async () => {
    const read = createReadTool({ fs });
    expectOk(await read({ path: "/a.txt" }, { signal: new AbortController().signal, callId: "x" }));
  });
});
