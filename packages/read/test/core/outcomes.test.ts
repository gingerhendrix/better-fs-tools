import { describe, expect, test } from "bun:test";

import type { FileSystem } from "@better-fs-tools/fs";

import { createReadTool, textOf } from "../../src/index.ts";
import { expectFailure, expectOk, harness, note } from "../helpers.ts";

describe("filesystem refusals", () => {
  test("a missing file is NOT_FOUND with nearby names", async () => {
    const { read } = harness({ files: { "/src/config.json": "{}\n" } });
    const result = expectFailure(await read({ path: "/src/config.jsan" }), "NOT_FOUND");
    expect(result.notes).toEqual([
      {
        code: "not-found",
        severity: "warning",
        message: '/src/config.jsan was not found. Nearby names: "config.json".',
        data: { suggestions: ["config.json"] },
      },
    ]);
  });

  test("with suggest: null a missing file is a plain NOT_FOUND", async () => {
    const { read } = harness({ files: { "/src/config.json": "{}\n" }, deps: { suggest: null } });
    const result = expectFailure(await read({ path: "/src/config.jsan" }), "NOT_FOUND");
    expect(result.notes).toEqual([
      { code: "not-found", severity: "warning", message: "/src/config.jsan was not found." },
    ]);
  });

  test("a directory is NOT_A_FILE with its kind", async () => {
    const { read } = harness({ files: { "/dir/a.txt": "x" } });
    const result = expectFailure(await read({ path: "/dir" }), "NOT_A_FILE");
    expect(result.notes[0]?.data).toEqual({ kind: "directory" });
    expect(textOf(result)).toBe(
      "[read:not-a-file] /dir is a directory; directories, FIFOs, sockets, and devices are refused before any content read.",
    );
  });

  test("a deny root is DANGEROUS_PATH with the detail", async () => {
    const { read } = harness({
      files: { "/secret/key": "k" },
      fsOptions: { denyRoots: ["/secret"] },
    });
    const result = expectFailure(await read({ path: "/secret/key" }), "DANGEROUS_PATH");
    expect(textOf(result)).toContain("(/secret)");
  });

  test("a buffered ceiling refuses an oversized object as DENIED", async () => {
    const { read } = harness({
      files: { "/big.txt": "x".repeat(64) },
      fsOptions: { maxBufferedBytes: 16 },
    });
    expectFailure(await read({ path: "/big.txt" }), "DENIED");
  });

  test("an adapter that throws from open() gives IO_ERROR", async () => {
    const { fs } = harness({});
    const throwing: FileSystem = {
      ...fs,
      open: async () => {
        throw new Error("socket closed");
      },
    };
    const result = expectFailure(
      await createReadTool({ fs: throwing })({ path: "/a.txt" }),
      "IO_ERROR",
    );
    expect(result.notes[0]?.data).toEqual({ detail: "socket closed" });
  });

  test("each filesystem reason maps to its code", async () => {
    const { fs } = harness({});
    const reasons = [
      ["outside-allowed-roots", "OUTSIDE_ALLOWED_ROOTS"],
      ["permission-denied", "PERMISSION_DENIED"],
      ["unsupported", "UNSUPPORTED_BACKEND"],
      ["io", "IO_ERROR"],
      ["aborted", "ABORTED"],
    ] as const;
    for (const [reason, code] of reasons) {
      const refusing: FileSystem = {
        ...fs,
        open: async () => ({ ok: false, error: { reason, cause: { code: "E1" } } }),
      };
      const result = expectFailure(
        await createReadTool({ fs: refusing })({ path: "/a.txt" }),
        code,
      );
      expect(result.notes).toHaveLength(1);
      if (code === "ABORTED") expect(result.notes[0]?.data).toEqual({ phase: "open" });
      else expect(result.notes[0]?.data).toEqual({ cause: { code: "E1" } });
    }
  });
});

describe("capability disclosure", () => {
  test("a buffered backend without identity discloses both", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      fsOptions: { streaming: false, identity: false },
    });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.file.identity).toBeNull();
    expect(note(result, "weak-identity")).toBeDefined();
    expect(note(result, "buffered-backend")).toBeDefined();
  });

  test("the file info names the backend, with resolvedFrom null when no resolver ran", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" }, fsOptions: { id: "mem-test" } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.file).toEqual({
      requestedPath: "/a.txt",
      resolvedPath: "/a.txt",
      displayPath: "/a.txt",
      backend: "mem-test",
      size: 4,
      mtimeMs: null,
      identity: "memory:/a.txt:1",
      mimeType: null,
      resolvedFrom: null,
      version: "memory:/a.txt:1",
    });
    expect(result.conversion).toBeNull();
  });

  test("file.version is info.version, also without the identity capability", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" }, fsOptions: { identity: false } });
    const result = expectOk(await read({ path: "/a.txt" }));
    expect(result.file.identity).toBeNull();
    expect(result.file.version).toBe("memory:/a.txt:1");
  });
});

describe("result envelope", () => {
  test("every status names the tool", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n", "/b.png": "\u0089PNG\r\n" } });
    expect((await read({ path: "/a.txt" })).tool).toBe("read");
    expect((await read({ path: "/b.png" })).tool).toBe("read");
    expect((await read({ path: "/missing" })).tool).toBe("read");
  });

  test("an error nests code, phase, message, and data from its note", async () => {
    const { read } = harness({ files: { "/src/config.json": "{}\n" } });
    const result = expectFailure(await read({ path: "/src/config.jsan" }), "NOT_FOUND");
    expect(result.error).toEqual({
      code: "NOT_FOUND",
      phase: "resolve",
      message: '/src/config.jsan was not found. Nearby names: "config.json".',
      data: { suggestions: ["config.json"] },
    });
    expect("code" in result).toBe(false);
  });

  test("the phase names the stage that failed", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\n" },
      deps: {
        authorize: { id: "no", authorize: () => ({ allow: false }) },
      },
    });
    expect(expectFailure(await read({ path: "" }), "INVALID_INPUT").error.phase).toBe("input");
    expect(expectFailure(await read({ path: "/a.txt" }), "DENIED").error.phase).toBe("authorize");
  });

  test("a result that is not an error has no error field", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" } });
    expect("error" in expectOk(await read({ path: "/a.txt" }))).toBe(false);
  });
});
