import { describe, expect, spyOn, test } from "bun:test";

import { defaultClassifiers, notebookClassifier } from "@better-fs-tools/read";

import type { Codec } from "../../src/index.ts";
import { utf8Codec } from "../../src/index.ts";
import { errorOf, errorCode, harness, note } from "../helpers.ts";

const off = { preconditions: { requireRead: "off" } } as const;

describe("load", () => {
  test("a file over maxFileBytes is TOO_LARGE before it is opened", async () => {
    const { fs, write } = harness({
      files: { "/big.txt": "0123456789" },
      deps: { ...off, limits: { maxFileBytes: 5 } },
    });
    const open = spyOn(fs, "open");
    const result = await write({ path: "/big.txt", content: "x" });
    expect(errorCode(result)).toBe("TOO_LARGE");
    expect(errorOf(result)?.phase).toBe("load");
    expect(open).not.toHaveBeenCalled();
  });

  test("a binary file is NOT_TEXT with the classifier's code", async () => {
    const { fs, write } = harness({
      files: { "/x.bin": Uint8Array.of(0, 1, 2, 0, 3) },
      deps: off,
    });
    const result = await write({ path: "/x.bin", content: "text" });
    expect(errorCode(result)).toBe("NOT_TEXT");
    expect(errorOf(result)?.data?.code).toBe("BINARY");
    expect(fs.peek("/x.bin")?.bytes).toEqual(Uint8Array.of(0, 1, 2, 0, 3));
  });

  test("an existing notebook is JSON text with the default classifiers", async () => {
    const notebook = '{"cells": [], "nbformat": 4, "metadata": {}}\n';
    const { fs, edit } = harness({ files: { "/n.ipynb": notebook }, deps: off });
    const result = await edit({
      path: "/n.ipynb",
      edits: [{ oldText: '"nbformat": 4', newText: '"nbformat": 5' }],
    });
    expect(result.status).toBe("ok");
    expect(new TextDecoder().decode(fs.peek("/n.ipynb")?.bytes)).toContain('"nbformat": 5');
  });

  test("notebookClassifier() in the chain makes an existing notebook NOT_TEXT", async () => {
    const notebook = '{"cells": [], "nbformat": 4, "metadata": {}}\n';
    const { write } = harness({
      files: { "/n.ipynb": notebook },
      deps: { ...off, classifiers: [notebookClassifier(), ...defaultClassifiers()] },
    });
    const result = await write({ path: "/n.ipynb", content: "{}" });
    expect(errorCode(result)).toBe("NOT_TEXT");
    expect(errorOf(result)?.data?.code).toBe("NOTEBOOK");
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
    expect(errorOf(result)?.data?.code).toBe("ROUND_TRIP");
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
      expect(errorOf(result)?.data?.code).toBe("UNKNOWN_ENCODING");
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
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
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
    expect(errorOf(result)?.phase).toBe("load");
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
    expect(errorOf(result)?.data).toEqual({ detail: "disk gone" });
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
    expect(errorOf(result)).toMatchObject({ code: "ABORTED", phase: "load" });
    release();
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(closed).toBe(true);
  });
});
