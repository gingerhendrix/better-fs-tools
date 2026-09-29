import { describe, expect, test } from "bun:test";

import { isWritableFileSystem, readOnlyFileSystem } from "@better-fs-tools/fs";
import type { WriteOptions } from "@better-fs-tools/fs";
import { InMemoryFs } from "just-bash";
import type { IFileSystem } from "just-bash";

import { justBashFileSystem } from "../src/index.ts";
import type { JustBashBackend } from "../src/index.ts";
import { intercept, writable } from "./backend.ts";
import { expectMutationError } from "./helpers.ts";

const ENCODER = new TextEncoder();
const CREATE: WriteOptions = { precondition: { kind: "absent" }, createParents: false };
const ANY: WriteOptions = { precondition: { kind: "any" }, createParents: false };

function recorded(fs: IFileSystem) {
  const calls: string[] = [];
  const log = (name: string) => (original: (...args: never[]) => unknown, args: never[]) => {
    calls.push(`${name}:${String(args[0])}`);
    return original(...args);
  };
  const backend = intercept(fs, {
    writeFile: log("writeFile"),
    mkdir: log("mkdir"),
    rm: log("rm"),
    chmod: log("chmod"),
    utimes: log("utimes"),
  });
  return { calls, backend };
}

async function versionOf(fs: ReturnType<typeof writable>, path: string): Promise<string> {
  const outcome = await fs.stat(path, {});
  if (!outcome.ok || !outcome.stat.exists) throw new Error(`expected ${path} to exist`);
  return outcome.stat.version;
}

describe("just-bash writes: shape", () => {
  test("justBashFileSystem writes; readOnlyFileSystem gives a read-only view", () => {
    const fs = new InMemoryFs();
    const wrapped = writable(fs);
    expect(isWritableFileSystem(wrapped)).toBe(true);
    expect(wrapped.writeCapabilities).toEqual({
      atomic: false,
      compareAndSwap: false,
      preserveMode: true,
    });
    expect(typeof wrapped.remove).toBe("function");
    expect("stage" in wrapped).toBe(false);
    expect(isWritableFileSystem(readOnlyFileSystem(wrapped))).toBe(false);
  });

  test("a backend without a write method still reads, and a write reports unsupported", async () => {
    const fs = new InMemoryFs({ "/a.txt": "alpha\n" });
    for (const method of ["writeFile", "mkdir", "rm", "chmod", "utimes"]) {
      const without = new Proxy(fs, {
        get: (target, property) =>
          property === method ? undefined : Reflect.get(target, property, target),
      });
      const wrapped = justBashFileSystem(without, { allowedRoots: ["/"] });
      const read = await wrapped.open("/a.txt", {});
      expect(read.ok).toBe(true);
      if (read.ok) await read.file.close();
      const outcome =
        method === "rm"
          ? await wrapped.remove("/a.txt", ANY)
          : await wrapped.write("/b.txt", ENCODER.encode("x"), CREATE);
      expect(outcome).toEqual({
        ok: false,
        error: {
          reason: "unsupported",
          detail: `the IFileSystem has no ${method}(), so this backend cannot write`,
        },
      });
    }
    expect(await fs.exists("/b.txt")).toBe(false);
  });

  test("a read-only backend with only the read methods fits the type, with no cast", async () => {
    const fs = new InMemoryFs({ "/a.txt": "alpha\n" });
    const readOnly: JustBashBackend = {
      lstat: (path) => fs.lstat(path),
      realpath: (path) => fs.realpath(path),
      stat: (path) => fs.stat(path),
      readFileBuffer: (path) => fs.readFileBuffer(path),
      readdir: (path) => fs.readdir(path),
    };
    const wrapped = justBashFileSystem(readOnly, { allowedRoots: ["/"] });
    const read = await wrapped.open("/a.txt", {});
    expect(read.ok).toBe(true);
    if (read.ok) await read.file.close();
    expect(await wrapped.write("/b.txt", ENCODER.encode("x"), CREATE)).toMatchObject({
      ok: false,
      error: { reason: "unsupported" },
    });
    const full: JustBashBackend = fs satisfies IFileSystem;
    expect(justBashFileSystem(full, { allowedRoots: ["/"] }).id).toBe("just-bash");
  });
});

describe("just-bash writes: symlinked parents", () => {
  test('"reject" refuses a write through a symlinked parent before any backend write', async () => {
    const fs = new InMemoryFs({ "/workspace/real/a.txt": "real" });
    await fs.symlink("/workspace/real", "/workspace/linked");
    const wrapped = writable(fs);
    expectMutationError(await wrapped.write("linked/b.txt", ENCODER.encode("x"), CREATE), "denied");
    expectMutationError(await wrapped.stat("linked/a.txt", {}), "denied");
    expect(await fs.exists("/workspace/real/b.txt")).toBe(false);
    const followed = writable(fs, { symlinks: "follow-within-roots" });
    const outcome = await followed.write("linked/b.txt", ENCODER.encode("x"), CREATE);
    expect(outcome.ok && outcome.file.resolvedPath).toBe("/workspace/real/b.txt");
  });
});

describe("just-bash writes: stat", () => {
  test("an existing file has the open() version, its mode, and identity by mode", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "alpha\n" });
    await fs.chmod("/workspace/a.txt", 0o600);
    for (const identity of ["required", "none"] as const) {
      const wrapped = writable(fs, { identity });
      const outcome = await wrapped.stat("a.txt", {});
      if (!outcome.ok || !outcome.stat.exists) throw new Error("expected an existing file");
      const opened = await wrapped.open("a.txt", {});
      if (!opened.ok) throw new Error("expected open to succeed");
      await opened.file.close();
      expect(outcome.stat).toMatchObject({
        resolvedPath: "/workspace/a.txt",
        displayPath: "a.txt",
        size: 6,
        mode: 0o600,
        hardLinks: null,
      });
      expect(outcome.stat.version).toBe(opened.file.info.version ?? "");
      expect(outcome.stat.identity).toBe(identity === "required" ? outcome.stat.version : null);
    }
  });

  test("a missing path lists its missing parents, outermost first", async () => {
    const wrapped = writable(new InMemoryFs({ "/workspace/a.txt": "a\n" }));
    expect(await wrapped.stat("new/deeper/x.txt", {})).toEqual({
      ok: true,
      stat: {
        exists: false,
        resolvedPath: "/workspace/new/deeper/x.txt",
        displayPath: "new/deeper/x.txt",
        missingDirectories: ["/workspace/new", "/workspace/new/deeper"],
      },
    });
  });

  test("refuses escapes, deny roots, file parents and a directory", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "a\n", "/workspace/secret/k.txt": "k\n" });
    const wrapped = writable(fs, { denyRoots: ["/workspace/secret"] });
    expectMutationError(await wrapped.stat("/outside.txt", {}), "outside-allowed-roots");
    expectMutationError(await wrapped.stat("secret/new.txt", {}), "dangerous-path");
    expectMutationError(await wrapped.stat("a.txt/x", {}), "not-found");
    expect(await wrapped.stat("secret", {})).toMatchObject({ ok: false });
    await fs.mkdir("/workspace/dir");
    expect(await wrapped.stat("dir", {})).toMatchObject({
      ok: false,
      error: { reason: "not-a-file", kind: "directory" },
    });
  });
});

describe("just-bash writes: symlinks", () => {
  test('"reject" refuses a leaf symlink and never writes through it', async () => {
    const fs = new InMemoryFs({ "/workspace/real.txt": "real\n" });
    await fs.symlink("/workspace/real.txt", "/workspace/link.txt");
    const { calls, backend } = recorded(fs);
    const wrapped = writable(backend);

    expectMutationError(await wrapped.stat("link.txt", {}), "denied");
    expectMutationError(await wrapped.write("link.txt", ENCODER.encode("x"), ANY), "denied");
    expectMutationError(
      await wrapped.remove("link.txt", { precondition: { kind: "any" } }),
      "denied",
    );
    expect(calls).toEqual([]);
    expect((await fs.lstat("/workspace/link.txt")).isSymbolicLink).toBe(true);
    expect(await fs.readFile("/workspace/real.txt")).toBe("real\n");
  });

  test('"follow-within-roots" writes the target inside the roots and keeps the link', async () => {
    const fs = new InMemoryFs({ "/workspace/real.txt": "real\n", "/outside/x.txt": "x\n" });
    await fs.symlink("/workspace/real.txt", "/workspace/link.txt");
    await fs.symlink("/outside/x.txt", "/workspace/out.txt");
    await fs.symlink("/workspace/nowhere.txt", "/workspace/dangling.txt");
    const wrapped = writable(fs, { symlinks: "follow-within-roots" });

    const outcome = await wrapped.write("link.txt", ENCODER.encode("new\n"), ANY);
    if (!outcome.ok) throw new Error(`write failed with ${outcome.error.reason}`);
    expect(outcome.file.resolvedPath).toBe("/workspace/real.txt");
    expect(await fs.readFile("/workspace/real.txt")).toBe("new\n");
    expect((await fs.lstat("/workspace/link.txt")).isSymbolicLink).toBe(true);

    expectMutationError(
      await wrapped.write("out.txt", ENCODER.encode("x"), ANY),
      "outside-allowed-roots",
    );
    expectMutationError(await wrapped.write("dangling.txt", ENCODER.encode("x"), CREATE), "denied");
    expect(await fs.exists("/workspace/nowhere.txt")).toBe(false);
  });
});

describe("just-bash writes: write", () => {
  test("creates with the given mode, then replaces and keeps the mode", async () => {
    const fs = new InMemoryFs({ "/workspace/keep.txt": "k\n" });
    const wrapped = writable(fs);
    const created = await wrapped.write("a.txt", ENCODER.encode("one\n"), {
      ...CREATE,
      mode: 0o600,
    });
    if (!created.ok) throw new Error(`create failed with ${created.error.reason}`);
    expect(created.file).toMatchObject({
      resolvedPath: "/workspace/a.txt",
      displayPath: "a.txt",
      size: 4,
      createdDirectories: [],
      atomic: false,
    });
    expect((await fs.stat("/workspace/a.txt")).mode & 0o7777).toBe(0o600);

    const replaced = await wrapped.write("a.txt", ENCODER.encode("two\n"), {
      ...ANY,
      precondition: { kind: "version", version: created.file.version ?? "" },
      mode: 0o644,
    });
    if (!replaced.ok) throw new Error(`replace failed with ${replaced.error.reason}`);
    expect(await fs.readFile("/workspace/a.txt")).toBe("two\n");
    expect((await fs.stat("/workspace/a.txt")).mode & 0o7777).toBe(0o600);
  });

  test("every same-size replace changes the version, even inside one millisecond", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "0\n" });
    const wrapped = writable(fs, { identity: "none" });
    const seen = new Set([await versionOf(wrapped, "a.txt")]);
    for (const digit of ["1", "2", "3", "4"]) {
      const outcome = await wrapped.write("a.txt", ENCODER.encode(`${digit}\n`), ANY);
      if (!outcome.ok) throw new Error(`write failed with ${outcome.error.reason}`);
      seen.add(outcome.file.version ?? "");
    }
    expect(seen.size).toBe(5);
  });

  test("checks the precondition before any backend write", async () => {
    const { calls, backend } = recorded(new InMemoryFs({ "/workspace/a.txt": "one\n" }));
    const wrapped = writable(backend);
    const stale = { ...ANY, precondition: { kind: "version", version: "stale" } } as const;
    expectMutationError(await wrapped.write("a.txt", ENCODER.encode("x"), CREATE), "exists");
    expectMutationError(await wrapped.write("a.txt", ENCODER.encode("x"), stale), "changed");
    expectMutationError(await wrapped.write("missing.txt", ENCODER.encode("x"), stale), "changed");
    expect(calls).toEqual([]);
  });

  test("refuses a missing parent without createParents, and creates and reports it with", async () => {
    const { calls, backend } = recorded(new InMemoryFs({ "/workspace/a.txt": "a\n" }));
    const wrapped = writable(backend);
    expectMutationError(
      await wrapped.write("new/deeper/x.txt", ENCODER.encode("x"), CREATE),
      "not-found",
    );
    expect(calls).toEqual([]);

    const outcome = await wrapped.write("new/deeper/x.txt", ENCODER.encode("x"), {
      ...CREATE,
      createParents: true,
    });
    if (!outcome.ok) throw new Error(`write failed with ${outcome.error.reason}`);
    expect(outcome.file.createdDirectories).toEqual(["/workspace/new", "/workspace/new/deeper"]);
    expect(calls).toEqual([
      "mkdir:/workspace/new",
      "mkdir:/workspace/new/deeper",
      "writeFile:/workspace/new/deeper/x.txt",
    ]);
  });

  test("never replaces a directory, and refuses bytes above the ceiling", async () => {
    const fs = new InMemoryFs({ "/workspace/dir/b.txt": "b\n" });
    const { calls, backend } = recorded(fs);
    const wrapped = writable(backend, { maxBufferedBytes: 4 });
    expectMutationError(await wrapped.write("dir", ENCODER.encode("x"), ANY), "not-a-file");
    expectMutationError(
      await wrapped.write("big.txt", ENCODER.encode("12345"), CREATE),
      "too-large",
    );
    expect(calls).toEqual([]);
    expect((await fs.stat("/workspace/dir")).isDirectory).toBe(true);
  });

  test("maps backend errors once and never keeps the message", async () => {
    const cases = [
      ["ENOSPC: no space left, write '/workspace/a.txt'", "no-space"],
      ["EROFS: read-only file system, write '/workspace/a.txt'", "read-only"],
      ["EEXIST: file exists, write '/workspace/a.txt'", "exists"],
      ["EACCES: permission denied, write '/workspace/a.txt'", "permission-denied"],
      ["disk on fire at /workspace/a.txt", "io"],
    ] as const;
    for (const [message, reason] of cases) {
      const backend = intercept(new InMemoryFs({ "/workspace/keep.txt": "k\n" }), {
        writeFile: () => {
          throw new Error(message);
        },
      });
      const error = expectMutationError(
        await writable(backend).write("a.txt", ENCODER.encode("x"), CREATE),
        reason,
      );
      expect(error.cause?.phase).toBe("writeFile");
      expect(JSON.stringify(error)).not.toContain("/workspace/a.txt");
    }
  });

  test("an aborted signal gives aborted before any backend call", async () => {
    const { calls, backend } = recorded(new InMemoryFs({ "/workspace/a.txt": "a\n" }));
    const wrapped = writable(backend);
    const signal = AbortSignal.abort();
    expectMutationError(await wrapped.stat("a.txt", { signal }), "aborted");
    expectMutationError(
      await wrapped.write("a.txt", ENCODER.encode("x"), { ...ANY, signal }),
      "aborted",
    );
    expectMutationError(
      await wrapped.remove("a.txt", { precondition: { kind: "any" }, signal }),
      "aborted",
    );
    expect(calls).toEqual([]);
  });
});

describe("just-bash writes: remove", () => {
  test("removes under the current version and refuses a stale one or a missing file", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "one\n" });
    const wrapped = writable(fs);
    expectMutationError(
      await wrapped.remove("a.txt", { precondition: { kind: "version", version: "stale" } }),
      "changed",
    );
    expect(await fs.exists("/workspace/a.txt")).toBe(true);

    const version = await versionOf(wrapped, "a.txt");
    const removed = await wrapped.remove("a.txt", { precondition: { kind: "version", version } });
    expect(removed).toEqual({
      ok: true,
      file: {
        resolvedPath: "/workspace/a.txt",
        displayPath: "a.txt",
        version: null,
        identity: null,
        size: null,
        createdDirectories: [],
        atomic: false,
      },
    });
    expect(await fs.exists("/workspace/a.txt")).toBe(false);
    expectMutationError(
      await wrapped.remove("a.txt", { precondition: { kind: "any" } }),
      "not-found",
    );
  });
});
