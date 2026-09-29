import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { FileSystem } from "@better-fs-tools/fs";

import { createReadTool, jsonFormatter, textOf } from "../../src/index.ts";
import type { ReadContext, ReadResult } from "../../src/index.ts";
import { expectFailure, expectOk, testDigest } from "../helpers.ts";

interface Host {
  readonly id: string;
  readonly secret: string;
}

const SENTINEL = "host-sentinel-7f3a";

function deepContains(
  value: unknown,
  needle: object,
  text: string,
  seen = new Set<unknown>(),
): boolean {
  if (value === needle) return true;
  if (typeof value === "string") return value.includes(text);
  if (value === null || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((entry) => deepContains(entry, needle, text, seen));
}

describe("fs(call)", () => {
  test("runs exactly once for each read, with the caller's call object", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\ntwo\n" } });
    const calls: ReadContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: (call) => {
        calls.push(call);
        return fs;
      },
    });
    const first: ReadContext<Host> = { host: { id: "a", secret: SENTINEL } };
    const second: ReadContext<Host> = { host: { id: "b", secret: SENTINEL }, callId: "c2" };
    expectOk(await read({ path: "/a.txt" }, first));
    expectOk(await read({ path: "/a.txt", offset: 2 }, second));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(first);
    expect(calls[1]).toBe(second);
  });

  test("runs once on a refusal path too", async () => {
    const fs = memoryFileSystem({ files: {} });
    let built = 0;
    const read = createReadTool({
      fs: () => {
        built += 1;
        return fs;
      },
    });
    expectFailure(await read({ path: "/missing.txt" }), "NOT_FOUND");
    expect(built).toBe(1);
  });

  test("a factory that throws gives EXTENSION_FAILED", async () => {
    const read = createReadTool({
      fs: (): FileSystem => {
        throw new Error("no workspace");
      },
    });
    const result = expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({ extension: "fs", phase: "open" });
    expect(textOf(result)).toContain("The fs extension failed during the open phase");
    expect(textOf(result)).not.toContain("no workspace");
  });

  test("a factory that returns something else gives EXTENSION_FAILED", async () => {
    const read = createReadTool({ fs: () => ({}) as FileSystem });
    expectFailure(await read({ path: "/a.txt" }), "EXTENSION_FAILED");
  });

  test("an aborted signal stops before fs(call)", async () => {
    let built = 0;
    const fs = memoryFileSystem({ files: { "/a.txt": "x\n" } });
    const read = createReadTool({
      fs: () => {
        built += 1;
        return fs;
      },
    });
    const controller = new AbortController();
    controller.abort();
    const result = expectFailure(
      await read({ path: "/a.txt" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "input" });
    expect(built).toBe(0);
  });
});

describe("host", () => {
  test("never appears in the result", async () => {
    const fs = memoryFileSystem({
      files: { "/a.txt": "one\ntwo\n", "/b.bin": new Uint8Array([0, 1]) },
    });
    const host: Host = { id: "session-1", secret: SENTINEL };
    const formatters = [undefined, jsonFormatter({ space: 2 })];
    const results: ReadResult[] = [];
    for (const formatter of formatters) {
      const read = createReadTool<Host>({
        fs,
        digest: testDigest(),
        ...(formatter === undefined ? {} : { formatter }),
      });
      for (const input of [
        { path: "/a.txt" },
        { path: "/b.bin" },
        { path: "/nope" },
        { path: "" },
      ]) {
        results.push(await read(input, { host, callId: "call-1" }));
      }
    }
    expect(results.map((result) => result.status)).toEqual([
      "ok",
      "unsupported",
      "error",
      "error",
      "ok",
      "unsupported",
      "error",
      "error",
    ]);
    for (const result of results) {
      expect(deepContains(result, host, SENTINEL)).toBe(false);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    }
  });
});
