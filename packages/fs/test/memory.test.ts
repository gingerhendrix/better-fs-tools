import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "../src/index.ts";
import type { FileSystemError, OpenFile, OpenOutcome } from "../src/index.ts";

const DECODER = new TextDecoder();

async function readAll(file: OpenFile): Promise<string> {
  let text = "";
  for await (const chunk of file.bytes()) text += DECODER.decode(chunk, { stream: true });
  return text + DECODER.decode();
}

function errorOf(outcome: OpenOutcome): FileSystemError {
  if (outcome.ok) throw new Error("expected an error outcome");
  return outcome.error;
}

describe("memoryFileSystem open", () => {
  test("opens a seeded file and streams it in chunks", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "abcdef" }, chunkBytes: 2 });
    const opened = await fs.open("/a.txt", {});
    if (!opened.ok) throw new Error("expected ok");
    const chunks: number[] = [];
    for await (const chunk of opened.file.bytes()) chunks.push(chunk.byteLength);
    expect(chunks).toEqual([2, 2, 2]);
    expect(opened.file.info).toEqual({
      resolvedPath: "/a.txt",
      displayPath: "/a.txt",
      size: 6,
      mtimeMs: null,
      identity: "memory:/a.txt:1",
      mimeType: null,
      version: "memory:/a.txt:1",
    });
  });

  test("info.version is set without identity and changes with the bytes", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" }, identity: false });
    const first = await fs.open("/a.txt", {});
    if (!first.ok) throw new Error("expected ok");
    expect(first.file.info.identity).toBeNull();
    expect(first.file.info.version).toBe("memory:/a.txt:1");
    fs.setFile("/a.txt", "two");
    const second = await fs.open("/a.txt", {});
    if (!second.ok) throw new Error("expected ok");
    expect(second.file.info.version).toBe("memory:/a.txt:2");
  });

  test("a buffered backend yields one chunk", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "abcdef" }, chunkBytes: 2, streaming: false });
    const opened = await fs.open("/a.txt", {});
    if (!opened.ok) throw new Error("expected ok");
    const chunks: number[] = [];
    for await (const chunk of opened.file.bytes()) chunks.push(chunk.byteLength);
    expect(chunks).toEqual([6]);
    expect(fs.capabilities).toEqual({ streaming: false, identity: true });
  });

  test("bytes() is single use", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "x" } });
    const opened = await fs.open("/a.txt", {});
    if (!opened.ok) throw new Error("expected ok");
    expect(await readAll(opened.file)).toBe("x");
    expect(() => opened.file.bytes()).toThrow(TypeError);
  });

  test("a directory is not-a-file with kind and target", async () => {
    const fs = memoryFileSystem({ files: { "/dir/a.txt": "x" }, directories: ["/empty"] });
    expect(errorOf(await fs.open("/dir", {}))).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/dir", displayPath: "/dir" },
    });
    expect(errorOf(await fs.open("/empty/", {}))).toMatchObject({
      reason: "not-a-file",
      target: { resolvedPath: "/empty" },
    });
  });

  test("refusals carry typed reasons", async () => {
    const fs = memoryFileSystem({
      files: { "/big.txt": "x".repeat(32), "/secret/key": "k" },
      denyRoots: ["/secret"],
      maxBufferedBytes: 16,
    });
    expect(errorOf(await fs.open("/missing.txt", {})).reason).toBe("not-found");
    expect(errorOf(await fs.open("/secret/key", {}))).toEqual({
      reason: "dangerous-path",
      detail: "/secret",
    });
    expect(errorOf(await fs.open("/big.txt", {}))).toMatchObject({
      reason: "too-large",
      limit: 16,
      size: 32,
    });
    const controller = new AbortController();
    controller.abort();
    expect(errorOf(await fs.open("/big.txt", { signal: controller.signal })).reason).toBe(
      "aborted",
    );
  });

  test("verify() reports a write or a removal after open", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one", "/b.txt": "two" } });
    const a = await fs.open("/a.txt", {});
    const b = await fs.open("/b.txt", {});
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(await a.file.verify()).toEqual({ ok: true, changed: false });
    fs.setFile("/a.txt", "changed");
    fs.deleteFile("/b.txt");
    expect(await a.file.verify()).toEqual({ ok: true, changed: true });
    expect(await b.file.verify()).toEqual({ ok: true, changed: true });
  });

  test("setMimeType sets the hint that open reports", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "x" } });
    fs.setMimeType("/a.txt", "text/x-custom");
    const opened = await fs.open("/a.txt", {});
    if (!opened.ok) throw new Error("expected ok");
    expect(opened.file.info.mimeType).toBe("text/x-custom");
  });

  test("without identity the handle has no identity", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "x" }, identity: false });
    const opened = await fs.open("/a.txt", {});
    if (!opened.ok) throw new Error("expected ok");
    expect(opened.file.info.identity).toBeNull();
  });
});

describe("memoryFileSystem list", () => {
  test("lists files and child directories by name", async () => {
    const fs = memoryFileSystem({ files: { "/d/a.txt": "a", "/d/sub/b.txt": "b" } });
    const listed = await fs.list?.("/d", { limit: 10 });
    expect(listed).toEqual({
      ok: true,
      entries: [
        { name: "a.txt", type: "file" },
        { name: "sub", type: "directory" },
      ],
      truncated: false,
    });
  });

  test("honours the limit and reports truncation", async () => {
    const fs = memoryFileSystem({ files: { "/d/a": "", "/d/b": "", "/d/c": "" } });
    const listed = await fs.list?.("/d", { limit: 2 });
    if (listed === undefined || !listed.ok) throw new Error("expected a listing");
    expect(listed.entries).toHaveLength(2);
    expect(listed.truncated).toBe(true);
  });

  test("a missing directory or a file is not-found", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "a" } });
    expect(await fs.list?.("/nope", { limit: 5 })).toEqual({
      ok: false,
      error: { reason: "not-found" },
    });
    expect(await fs.list?.("/a.txt", { limit: 5 })).toEqual({
      ok: false,
      error: { reason: "not-found", detail: "not a directory" },
    });
  });

  test("list: false removes the method", () => {
    const fs = memoryFileSystem({ list: false });
    expect(fs.list).toBeUndefined();
    expect("list" in fs).toBe(false);
  });
});
