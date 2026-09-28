import { describe, expect, spyOn, test } from "bun:test";

import type { Codec } from "../../src/index.ts";
import { utf8Codec } from "../../src/index.ts";
import { errorCode, harness, note } from "../helpers.ts";

const off = { preconditions: { requireRead: "off" } } as const;

describe("load (section 5.2)", () => {
  test("a file over maxFileBytes is TOO_LARGE before it is opened", async () => {
    const { fs, write } = harness({
      files: { "/big.txt": "0123456789" },
      deps: { ...off, limits: { maxFileBytes: 5 } },
    });
    const open = spyOn(fs, "open");
    const result = await write({ path: "/big.txt", content: "x" });
    expect(errorCode(result)).toBe("TOO_LARGE");
    expect(result.error?.phase).toBe("load");
    expect(open).not.toHaveBeenCalled();
  });

  test("a binary file is NOT_TEXT with the classifier's code", async () => {
    const { fs, write } = harness({
      files: { "/x.bin": Uint8Array.of(0, 1, 2, 0, 3) },
      deps: off,
    });
    const result = await write({ path: "/x.bin", content: "text" });
    expect(errorCode(result)).toBe("NOT_TEXT");
    expect(result.error?.data?.code).toBe("BINARY");
    expect(fs.peek("/x.bin")?.bytes).toEqual(Uint8Array.of(0, 1, 2, 0, 3));
  });

  test("a codec whose encode does not give the bytes back is NOT_TEXT ROUND_TRIP", async () => {
    const base = utf8Codec();
    const lossy: Codec = {
      ...base,
      id: "lossy",
      encode: (text) => new TextEncoder().encode(text.trim()),
    };
    const { write } = harness({ files: { "/a.txt": "a \n" }, deps: { ...off, codecs: [lossy] } });
    const result = await write({ path: "/a.txt", content: "b" });
    expect(errorCode(result)).toBe("NOT_TEXT");
    expect(result.error?.data?.code).toBe("ROUND_TRIP");
    expect(note(result, "not-text")?.message).toContain("same bytes");
  });

  test("no codec accepts, or decode fails: NOT_TEXT UNKNOWN_ENCODING", async () => {
    const refuses: Codec = { ...utf8Codec(), id: "none", accepts: () => false };
    const failing: Codec = {
      ...utf8Codec(),
      id: "fails",
      decode: () => ({ ok: false, detail: "no" }),
    };
    for (const codec of [refuses, failing]) {
      const { write } = harness({ files: { "/a.txt": "a" }, deps: { ...off, codecs: [codec] } });
      const result = await write({ path: "/a.txt", content: "b" });
      expect(result.error?.data?.code).toBe("UNKNOWN_ENCODING");
    }
  });

  test("a throwing codec is EXTENSION_FAILED with its id", async () => {
    const codec: Codec = {
      ...utf8Codec(),
      id: "boom",
      decode: () => {
        throw new Error("boom");
      },
    };
    const { write } = harness({ files: { "/a.txt": "a" }, deps: { ...off, codecs: [codec] } });
    const result = await write({ path: "/a.txt", content: "b" });
    expect(result.error).toEqual({
      code: "EXTENSION_FAILED",
      phase: "load",
      data: { extension: "codecs", phase: "load", id: "boom" },
    });
  });

  test("no classifier opinion is UNSUPPORTED_BACKEND", async () => {
    const { write } = harness({
      files: { "/a.txt": "a" },
      deps: { ...off, classifiers: [{ id: "silent", classify: () => null }] },
    });
    expect(errorCode(await write({ path: "/a.txt", content: "b" }))).toBe("UNSUPPORTED_BACKEND");
  });

  test("an open version that differs from the stat version is STALE", async () => {
    const { fs, write } = harness({ files: { "/a.txt": "a" }, deps: off });
    const open = fs.open.bind(fs);
    spyOn(fs, "open").mockImplementation(async (path, options) => {
      fs.setFile("/a.txt", "changed");
      return open(path, options);
    });
    const result = await write({ path: "/a.txt", content: "b" });
    expect(errorCode(result)).toBe("STALE");
    expect(result.error?.phase).toBe("load");
  });

  test("verify reporting a change is STALE, and the handle is closed", async () => {
    const { fs, write } = harness({ files: { "/a.txt": "a" }, deps: off });
    const open = fs.open.bind(fs);
    let closed = false;
    spyOn(fs, "open").mockImplementation(async (path, options) => {
      const opened = await open(path, options);
      if (!opened.ok) return opened;
      const file = opened.file;
      return {
        ok: true,
        file: {
          info: file.info,
          bytes: () => file.bytes(),
          verify: async () => ({ ok: true, changed: true }),
          close: async () => {
            closed = true;
            await file.close();
          },
        },
      };
    });
    expect(errorCode(await write({ path: "/a.txt", content: "b" }))).toBe("STALE");
    expect(closed).toBe(true);
  });

  test("a throwing byte source is IO_ERROR", async () => {
    const { fs, write } = harness({ files: { "/a.txt": "a" }, deps: off });
    const open = fs.open.bind(fs);
    spyOn(fs, "open").mockImplementation(async (path, options) => {
      const opened = await open(path, options);
      if (!opened.ok) return opened;
      return {
        ok: true,
        file: {
          ...opened.file,
          info: opened.file.info,
          bytes: () => ({
            [Symbol.asyncIterator]: () => ({
              next: async () => {
                throw new Error("disk gone");
              },
            }),
          }),
          verify: () => opened.file.verify(),
          close: () => opened.file.close(),
        },
      };
    });
    const result = await write({ path: "/a.txt", content: "b" });
    expect(errorCode(result)).toBe("IO_ERROR");
    expect(result.error?.data).toEqual({ detail: "disk gone" });
  });
});

describe("load and abort", () => {
  test("a handle that opens after an abort is closed", async () => {
    const { fs, write } = harness({ files: { "/a.txt": "a" }, deps: off });
    const open = fs.open.bind(fs);
    const controller = new AbortController();
    let closed = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    spyOn(fs, "open").mockImplementation(async (path) => {
      controller.abort();
      await gate;
      const opened = await open(path, {});
      if (!opened.ok) return opened;
      const file = opened.file;
      return {
        ok: true,
        file: {
          info: file.info,
          bytes: () => file.bytes(),
          verify: () => file.verify(),
          close: async () => {
            closed = true;
            await file.close();
          },
        },
      };
    });
    const result = await write({ path: "/a.txt", content: "b" }, { signal: controller.signal });
    expect(result.error).toMatchObject({ code: "ABORTED", phase: "load" });
    release();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(closed).toBe(true);
  });
});
