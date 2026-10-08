import { describe, expect, test } from "bun:test";

import { isWritableFileSystem } from "@better-fs-tools/fs";
import type { WriteOptions } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";

import { cloudflareComputerFileSystem } from "../src/index.ts";
import type { CloudflareComputerFileSystemLike } from "../src/index.ts";
import { ROOT, fakeComputer, fsError, fsFor } from "./fake-computer.ts";
import { expectMutationError } from "./helpers.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const CREATE: WriteOptions = { precondition: { kind: "absent" }, createParents: false };
const ANY: WriteOptions = { precondition: { kind: "any" }, createParents: false };

function text(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : DECODER.decode(bytes);
}

function writes(calls: readonly string[]): string[] {
  return calls.filter((call) => /^(writeFile|mkdir|rm):/u.test(call));
}

describe("cloudflare computer writes: shape", () => {
  test("reports writes without compare-and-swap, remove, and no stage", () => {
    const { fs } = fsFor();
    expect(isWritableFileSystem(fs)).toBe(true);
    expect(fs.writeCapabilities).toEqual({
      compareAndSwap: false,
    });
    expect(typeof fs.remove).toBe("function");
    expect("stage" in fs).toBe(false);
  });

  test("a filesystem without a write method still reads; a write reports unsupported", async () => {
    const backend = fakeComputer({ "/workspace/a.txt": "alpha\n" });
    for (const method of ["writeFile", "mkdir", "rm"] as const) {
      const { [method]: _dropped, ...without } = backend;
      const fs = cloudflareComputerFileSystem(without as CloudflareComputerFileSystemLike, {
        allowedRoots: [ROOT],
      });
      const opened = await fs.open("a.txt", {});
      expect(opened.ok).toBe(true);
      if (opened.ok) await opened.file.close();
      const outcome =
        method === "rm"
          ? await fs.remove("a.txt", ANY)
          : await fs.write("b.txt", ENCODER.encode("x"), CREATE);
      expect(outcome).toEqual({
        ok: false,
        error: {
          reason: "unsupported",
          detail: `the Computer workspace filesystem has no ${method}(), so this backend cannot write`,
        },
      });
    }
    expect((await backend.lstat("/workspace/a.txt")).isFile).toBe(true);
  });

  test("a read-only wrapper backs the read tool", async () => {
    const backend = fakeComputer({ "/workspace/a.txt": "alpha\n" });
    const readOnly: CloudflareComputerFileSystemLike = {
      readFile: (path) => backend.readFile(path),
      stat: (path) => backend.stat(path),
      lstat: (path) => backend.lstat(path),
      readdir: (path, options) => backend.readdir(path, options),
    };
    const read = createReadTool({
      fs: cloudflareComputerFileSystem(readOnly, { allowedRoots: [ROOT] }),
    });
    expect(textOf(await read({ path: "a.txt" })).split("\n")[0]).toBe("1|alpha");
  });
});

describe("cloudflare computer writes: stat", () => {
  test("an existing file has the open() version and its mode", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const entry = backend.entries.get("/workspace/a.txt");
    if (entry !== undefined) entry.mode = 0o600;
    const outcome = await fs.stat("a.txt", {});
    if (!outcome.ok || !outcome.stat.exists) throw new Error("expected an existing file");
    const opened = await fs.open("a.txt", {});
    if (!opened.ok) throw new Error("expected open to succeed");
    await opened.file.close();

    expect(outcome.stat).toMatchObject({
      resolvedPath: "/workspace/a.txt",
      displayPath: "a.txt",
      size: 6,
      identity: null,
      mode: 0o600,
      hardLinks: null,
    });
    expect(outcome.stat.version).toBe(opened.file.info.version ?? "");
  });

  test("a missing path lists its missing parents, outermost first", async () => {
    const { fs } = fsFor({ "/workspace/a.txt": "a\n" });
    expect(await fs.stat("new/deeper/x.txt", {})).toEqual({
      ok: true,
      stat: {
        exists: false,
        resolvedPath: "/workspace/new/deeper/x.txt",
        displayPath: "new/deeper/x.txt",
        missingDirectories: ["/workspace/new", "/workspace/new/deeper"],
      },
    });
  });

  test("a backend without a usable mode reports null", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "a\n" });
    backend.override.lstat = async (path: string) => ({
      ...(await backend.unoverridden.lstat(path)),
      mode: -1,
    });
    const outcome = await fs.stat("a.txt", {});
    expect(outcome.ok && outcome.stat.exists && outcome.stat.mode).toBeNull();
  });

  test("refuses symlinks, directories, escapes, file parents and a missing root", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "a\n", "/workspace/dir/b.txt": "b\n" });
    backend.link("/workspace/leaf", "/workspace/a.txt");
    backend.link("/workspace/linked", "/workspace/dir");

    expectMutationError(await fs.stat("leaf", {}), "denied");
    expectMutationError(await fs.stat("linked/b.txt", {}), "denied");
    expectMutationError(await fs.stat("linked/new.txt", {}), "denied");
    expect(await fs.stat("dir", {})).toMatchObject({
      ok: false,
      error: { reason: "not-a-file", kind: "directory" },
    });
    expectMutationError(await fs.stat("/etc/passwd", {}), "outside-allowed-roots");
    expectMutationError(await fs.stat("a.txt/x", {}), "not-found");

    const empty = cloudflareComputerFileSystem(fakeComputer(), { allowedRoots: ["/missing"] });
    expectMutationError(await empty.stat("x.txt", {}), "not-found");
  });
});

describe("cloudflare computer writes: write", () => {
  test("creates exclusively with the given mode, then replaces and keeps the mode", async () => {
    const { backend, fs } = fsFor();
    const created = await fs.write("a.txt", ENCODER.encode("one\n"), { ...CREATE, mode: 0o600 });
    if (!created.ok) throw new Error(`create failed with ${created.error.reason}`);
    expect(created.file).toMatchObject({
      resolvedPath: "/workspace/a.txt",
      displayPath: "a.txt",
      identity: null,
      size: 4,
      createdDirectories: [],
    });

    const version = created.file.version ?? "";
    const replaced = await fs.write("a.txt", ENCODER.encode("two\n"), {
      ...ANY,
      precondition: { kind: "version", version },
      mode: 0o644,
    });
    if (!replaced.ok) throw new Error(`replace failed with ${replaced.error.reason}`);
    expect(replaced.file.version).not.toBe(version);
    const entry = backend.entries.get("/workspace/a.txt");
    expect(text(entry?.bytes)).toBe("two\n");
    expect(entry?.mode).toBe(0o600);
  });

  test("a creator that wins between the check and the write gives exists", async () => {
    const { backend, fs } = fsFor();
    const original = backend.writeFile.bind(backend);
    backend.writeFile = async (path, content, options) => {
      backend.put(path, "the other creator\n");
      return original(path, content, options);
    };
    expectMutationError(await fs.write("a.txt", ENCODER.encode("mine\n"), CREATE), "exists");
    expect(text(backend.entries.get("/workspace/a.txt")?.bytes)).toBe("the other creator\n");
  });

  test("checks the precondition before the backend call", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "one\n" });
    const stale = { ...ANY, precondition: { kind: "version", version: "computer:4:1" } } as const;
    expectMutationError(await fs.write("a.txt", ENCODER.encode("x"), CREATE), "exists");
    expectMutationError(await fs.write("a.txt", ENCODER.encode("x"), stale), "changed");
    expectMutationError(await fs.write("missing.txt", ENCODER.encode("x"), stale), "changed");
    expect(writes(backend.calls)).toEqual([]);
  });

  test("refuses a missing parent without createParents, and creates and reports it with", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "a\n" });
    expectMutationError(
      await fs.write("new/deeper/x.txt", ENCODER.encode("x"), CREATE),
      "not-found",
    );
    expect(writes(backend.calls)).toEqual([]);

    const outcome = await fs.write("new/deeper/x.txt", ENCODER.encode("x"), {
      ...CREATE,
      createParents: true,
    });
    if (!outcome.ok) throw new Error(`write failed with ${outcome.error.reason}`);
    expect(outcome.file.createdDirectories).toEqual(["/workspace/new", "/workspace/new/deeper"]);
    expect(writes(backend.calls)).toEqual([
      "mkdir:/workspace/new",
      "mkdir:/workspace/new/deeper",
      "writeFile:/workspace/new/deeper/x.txt",
    ]);
  });

  test("never writes through a symlink or onto a directory", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "a\n", "/workspace/dir/b.txt": "b\n" });
    backend.link("/workspace/leaf", "/workspace/a.txt");
    backend.link("/workspace/linked", "/workspace/dir");
    backend.link("/workspace/dangling", "/workspace/nowhere.txt");

    expectMutationError(await fs.write("leaf", ENCODER.encode("x"), ANY), "denied");
    expectMutationError(await fs.write("dangling", ENCODER.encode("x"), CREATE), "denied");
    expectMutationError(
      await fs.write("linked/new.txt", ENCODER.encode("x"), { ...CREATE, createParents: true }),
      "denied",
    );
    expectMutationError(await fs.write("dir", ENCODER.encode("x"), ANY), "not-a-file");
    expect(writes(backend.calls)).toEqual([]);
    expect(text(backend.entries.get("/workspace/a.txt")?.bytes)).toBe("a\n");
  });

  test("maps Computer's error codes once and never keeps the message", async () => {
    const { backend, fs } = fsFor();
    const cases = [
      ["EEXIST", "exists"],
      ["ENOSPC", "no-space"],
      ["EROFS", "read-only"],
      ["ENOENT", "not-found"],
      ["EACCES", "permission-denied"],
      ["SQLITE_BUSY", "io"],
    ] as const;
    for (const [code, reason] of cases) {
      backend.override.writeFile = () => {
        throw fsError(code, "failed at /workspace/a.txt");
      };
      const error = expectMutationError(
        await fs.write("a.txt", ENCODER.encode("x"), CREATE),
        reason,
      );
      expect(error.cause).toEqual({ code, phase: "writeFile" });
      expect(JSON.stringify(error)).not.toContain("/workspace/a.txt");
    }
  });

  test("an aborted signal gives aborted before any backend call", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "a\n" });
    const signal = AbortSignal.abort();
    expectMutationError(await fs.stat("a.txt", { signal }), "aborted");
    expectMutationError(
      await fs.write("a.txt", ENCODER.encode("x"), { ...ANY, signal }),
      "aborted",
    );
    expectMutationError(
      await fs.remove("a.txt", { precondition: { kind: "any" }, signal }),
      "aborted",
    );
    expect(backend.calls).toEqual([]);
  });
});

describe("cloudflare computer writes: remove", () => {
  test("removes under the current version and refuses a stale one", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "one\n" });
    expectMutationError(
      await fs.remove("a.txt", { precondition: { kind: "version", version: "computer:4:1" } }),
      "changed",
    );
    expect(backend.entries.has("/workspace/a.txt")).toBe(true);

    const stat = await fs.stat("a.txt", {});
    if (!stat.ok || !stat.stat.exists) throw new Error("expected an existing file");
    const removed = await fs.remove("a.txt", {
      precondition: { kind: "version", version: stat.stat.version },
    });
    expect(removed).toEqual({
      ok: true,
      file: {
        resolvedPath: "/workspace/a.txt",
        displayPath: "a.txt",
        version: null,
        identity: null,
        size: null,
        createdDirectories: [],
      },
    });
    expect(backend.entries.has("/workspace/a.txt")).toBe(false);
  });

  test("refuses a missing file, a symlink and a directory", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "a\n", "/workspace/dir/b.txt": "b\n" });
    backend.link("/workspace/leaf", "/workspace/a.txt");
    const any = { precondition: { kind: "any" } } as const;
    expectMutationError(await fs.remove("missing.txt", any), "not-found");
    expectMutationError(await fs.remove("leaf", any), "denied");
    expectMutationError(await fs.remove("dir", any), "not-a-file");
    expect(writes(backend.calls)).toEqual([]);
  });
});
