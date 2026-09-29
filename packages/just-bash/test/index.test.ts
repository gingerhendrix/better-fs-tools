import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { DEFAULT_MAX_BUFFERED_BYTES, posixPaths } from "@better-fs-tools/fs";
import type { OpenFile, OpenOutcome } from "@better-fs-tools/fs";
import { InMemoryFs, MountableFs } from "just-bash";
import type { FsStat } from "just-bash";

import { justBashFileSystem } from "../src/index.ts";
import { adapter, intercept } from "./backend.ts";
import { expectFsError, sourceSpecifiers } from "./helpers.ts";

const DECODER = new TextDecoder();

function opened(outcome: OpenOutcome): OpenFile {
  if (!outcome.ok) throw new Error(`expected open handle, got ${outcome.error.reason}`);
  return outcome.file;
}

async function contents(file: OpenFile): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of file.bytes()) chunks.push(Uint8Array.from(chunk));
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

describe("justBashFileSystem", () => {
  test("validates fixed policy and advertises buffered capabilities", () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "alpha" });
    const wrapped = adapter(fs, { identity: "none" });
    expect(wrapped.capabilities).toEqual({ streaming: false, identity: false });
    expect(typeof wrapped.list).toBe("function");
    expect(wrapped.paths).toBe(posixPaths);
    expect(wrapped.cwd).toBe("/workspace");
    expect(wrapped.identity).toBe("none");
    expect(wrapped.symlinks).toBe("reject");
    expect(adapter(fs).capabilities).toEqual({ streaming: false, identity: true });

    expect(() => adapter(fs, { allowedRoots: [] })).toThrow("allowedRoots");
    expect(() => adapter(fs, { maxBufferedBytes: 0 })).toThrow("maxBufferedBytes");
    expect(() => adapter(fs, { cwd: "relative" })).toThrow("cwd");
    expect(() => adapter(fs, { symlinks: "backend-policy" as never })).toThrow("symlinks");
  });

  test("defaults id, cwd, and maxBufferedBytes from the shared options", () => {
    const wrapped = justBashFileSystem(new InMemoryFs(), { allowedRoots: ["/workspace"] });
    expect(wrapped.id).toBe("just-bash");
    expect(wrapped.cwd).toBe("/");
    expect(wrapped.allowedRoots).toEqual(["/workspace"]);
    expect(wrapped.denyRoots).toEqual([]);
    expect(wrapped.maxBufferedBytes).toBe(DEFAULT_MAX_BUFFERED_BYTES);
    expect(wrapped.identity).toBe("none");
    expect(wrapped.symlinks).toBe("reject");
  });

  test('"reject" refuses a symlinked parent too; "follow-within-roots" follows it', async () => {
    const fs = new InMemoryFs({ "/workspace/real/a.txt": "real" });
    await fs.symlink("/workspace/real", "/workspace/linked");
    expectFsError(await adapter(fs).open("linked/a.txt", {}), "denied");
    expectFsError(await adapter(fs).list("linked", { limit: 5 }), "denied");
    const followed = opened(
      await adapter(fs, { symlinks: "follow-within-roots" }).open("linked/a.txt", {}),
    );
    expect(followed.info.resolvedPath).toBe("/workspace/real/a.txt");
    await followed.close();
  });

  test("opens normal and empty files and enforces both buffered ceiling edges", async () => {
    const fs = new InMemoryFs({
      "/workspace/exact.bin": Uint8Array.of(1, 2, 3, 4),
      "/workspace/empty.bin": new Uint8Array(),
      "/workspace/large.bin": Uint8Array.of(1, 2, 3, 4, 5),
    });
    const wrapped = adapter(fs, { maxBufferedBytes: 4 });

    const exact = opened(await wrapped.open("exact.bin", {}));
    expect([...(await contents(exact))]).toEqual([1, 2, 3, 4]);
    await exact.close();
    const empty = opened(await wrapped.open("empty.bin", {}));
    expect((await contents(empty)).byteLength).toBe(0);
    await empty.close();
    expect(expectFsError(await wrapped.open("large.bin", {}), "too-large")).toMatchObject({
      limit: 4,
      size: 5,
    });

    const staleSize = intercept(fs, {
      stat: async (original, args) => {
        const stat = (await original(...args)) as FsStat;
        return { ...stat, size: args[0] === "/workspace/large.bin" ? 4 : stat.size };
      },
    });
    expectFsError(
      await adapter(staleSize, { maxBufferedBytes: 4 }).open("large.bin", {}),
      "too-large",
    );
  });

  test("copies aliased backend bytes before exposing the handle", async () => {
    const fs = new InMemoryFs({ "/workspace/a.bin": Uint8Array.of(1, 2, 3) });
    const file = opened(await adapter(fs).open("a.bin", {}));
    const iterator = file.bytes()[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error("expected one buffered chunk");
    first.value[0] = 99;
    expect([...(await fs.readFileBuffer("/workspace/a.bin"))]).toEqual([1, 2, 3]);
    await file.close();
  });

  test("maps message-only POSIX errors and never exposes backend messages", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "alpha" });
    const missing = expectFsError(await adapter(fs).open("secret-missing.txt", {}), "not-found", {
      code: "ENOENT",
      phase: "lstat",
    });
    expect(missing.detail ?? "").not.toContain("secret-missing");

    const unknown = intercept(fs, {
      lstat: () => {
        throw new Error("backend exploded at /host/private.txt");
      },
    });
    const unknownError = expectFsError(await adapter(unknown).open("a.txt", {}), "io", {
      code: "UNKNOWN",
      phase: "lstat",
    });
    expect(unknownError.detail).toBe("lstat");
    expect(JSON.stringify(unknownError)).not.toContain("/host/private.txt");

    const ownCode = intercept(fs, {
      lstat: () => {
        throw Object.assign(new Error("ENOENT: /host/private.txt"), { code: "EACCES" });
      },
    });
    expectFsError(await adapter(ownCode).open("a.txt", {}), "permission-denied", {
      code: "EACCES",
    });
  });

  test("supports required and weak identity modes plus dev:ino fallback", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "alpha" });
    const strong = opened(await adapter(fs).open("a.txt", {}));
    expect(strong.info.identity).toContain("test-just-bash");
    expect(strong.info.version).toBe(strong.info.identity);
    await strong.close();

    const weak = opened(await adapter(fs, { identity: "none" }).open("a.txt", {}));
    expect(weak.info.identity).toBeNull();
    expect(weak.info.version).toContain("weak:5:");
    await fs.writeFile("/workspace/a.txt", "longer");
    expect(await weak.verify()).toEqual({ ok: true, changed: true });
    const reopened = opened(await adapter(fs, { identity: "none" }).open("a.txt", {}));
    expect(reopened.info.version).not.toBe(weak.info.version);
    await reopened.close();
    await weak.close();

    const noIdentity = intercept(fs, {
      stat: async (original, args) => {
        const {
          identity: _identity,
          dev: _dev,
          ino: _ino,
          ...stat
        } = (await original(...args)) as FsStat;
        return stat;
      },
    });
    expectFsError(await adapter(noIdentity).open("a.txt", {}), "unsupported", {
      code: "IDENTITY_UNAVAILABLE",
      phase: "stat-key",
    });

    const inodeOnly = intercept(fs, {
      stat: async (original, args) => {
        const { identity: _identity, ...stat } = (await original(...args)) as FsStat;
        return { ...stat, dev: 7, ino: 11 };
      },
    });
    const inodeFile = opened(await adapter(inodeOnly).open("a.txt", {}));
    expect(inodeFile.info.identity).toContain("inode:7:11");
    await inodeFile.close();
  });

  test("rejects invalid, escaped, denied and final-symlink paths before reading", async () => {
    const fs = new InMemoryFs({
      "/work/a.txt": "work",
      "/workspace/a.txt": "workspace",
      "/workspace/private/a.txt": "private",
    });
    await fs.symlink("/workspace/a.txt", "/workspace/link.txt");
    const wrapped = justBashFileSystem(fs, {
      id: "roots",
      cwd: "/",
      allowedRoots: ["/work"],
      maxBufferedBytes: 100,
      identity: "required",
    });
    expectFsError(await wrapped.open("/workspace/a.txt", {}), "outside-allowed-roots");
    const denied = await adapter(fs, { denyRoots: ["private"] }).open("private/a.txt", {});
    expectFsError(denied, "dangerous-path");
    expect(denied.ok ? null : denied.error.detail).toBe("/workspace/private");
    expectFsError(await adapter(fs).open("link.txt", {}), "denied");
    expectFsError(await adapter(fs).open("a\0.txt", {}), "dangerous-path");

    const followed = opened(
      await adapter(fs, { symlinks: "follow-within-roots" }).open("link.txt", {}),
    );
    expect(DECODER.decode(await contents(followed))).toBe("workspace");
    expect(followed.info.resolvedPath).toBe("/workspace/a.txt");
    await followed.close();
  });

  test("lists with native dirents and fallback lstat, truncates, and validates limits", async () => {
    const fs = new InMemoryFs({
      "/workspace/a.txt": "a",
      "/workspace/b.txt": "b",
      "/workspace/dir/c.txt": "c",
    });
    const native = adapter(fs);
    const listed = await native.list(".", { limit: 2 });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.entries).toHaveLength(2);
      expect(listed.truncated).toBe(true);
      expect(listed.entries.every((entry) => !entry.name.includes("/"))).toBe(true);
    }
    expectFsError(await native.list(".", { limit: 0 }), "io");
    expectFsError(await native.list(".", { limit: 1.5 }), "io");
    expectFsError(await native.list(".", { limit: Number.MAX_SAFE_INTEGER + 1 }), "io");

    const mounted = new MountableFs({
      base: new InMemoryFs({ "/base.txt": "base" }),
      mounts: [{ mountPoint: "/workspace", filesystem: fs }],
    });
    const fallback = justBashFileSystem(mounted, {
      id: "mounted-list",
      cwd: "/",
      allowedRoots: ["/"],
      maxBufferedBytes: 1_024,
      identity: "required",
    });
    const root = await fallback.list("/", { limit: 1 });
    expect(root.ok).toBe(true);
    if (root.ok) {
      expect(root.entries).toHaveLength(1);
      expect(root.truncated).toBe(true);
    }
  });

  test("listing a file gives not-found, as memoryFileSystem does", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "a" });
    const error = expectFsError(await adapter(fs).list("a.txt", { limit: 4 }), "not-found");
    expect(error.detail).toBe("not a directory");
  });

  test("checks abort after every uncancellable open call", async () => {
    for (const method of ["lstat", "realpath", "stat", "readFileBuffer"] as const) {
      const fs = new InMemoryFs({ "/workspace/a.txt": "alpha" });
      const controller = new AbortController();
      const wrappedBackend = intercept(fs, {
        [method]: async (original: (...args: never[]) => unknown, args: never[]) => {
          const value = await original(...args);
          controller.abort();
          return value;
        },
      });
      const result = await adapter(wrappedBackend).open("a.txt", { signal: controller.signal });
      expectFsError(result, "aborted", { phase: method === "stat" ? "stat-before" : method });
    }
  });

  test("checks abort around listing fallback work and verification", async () => {
    const child = new InMemoryFs({ "/a.txt": "alpha" });
    const mounted = new MountableFs({
      mounts: [{ mountPoint: "/workspace", filesystem: child }],
    });
    const listController = new AbortController();
    let lstatCalls = 0;
    const abortingList = intercept(mounted, {
      lstat: async (original, args) => {
        const value = await original(...args);
        lstatCalls += 1;
        // The leaf lstat, the "reject" walk of /workspace, then the first child.
        if (lstatCalls === 3) listController.abort();
        return value;
      },
    });
    const listAdapter = justBashFileSystem(abortingList, {
      id: "abort-list",
      cwd: "/",
      allowedRoots: ["/"],
      maxBufferedBytes: 1_024,
      identity: "required",
    });
    expectFsError(
      await listAdapter.list("/workspace", { limit: 1, signal: listController.signal }),
      "aborted",
      { phase: "list-lstat" },
    );

    const fs = new InMemoryFs({ "/workspace/a.txt": "alpha" });
    const verifyController = new AbortController();
    let statCalls = 0;
    const abortingVerify = intercept(fs, {
      stat: async (original, args) => {
        const value = await original(...args);
        statCalls += 1;
        if (statCalls === 3) verifyController.abort();
        return value;
      },
    });
    const file = opened(
      await adapter(abortingVerify).open("a.txt", { signal: verifyController.signal }),
    );
    expectFsError(await file.verify(), "aborted", { phase: "verify-stat" });
    await file.close();
  });

  test("detects open-time inconsistency with a safe typed phase", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "alpha" });
    const racing = intercept(fs, {
      readFileBuffer: async (original, args) => {
        const bytes = await original(...args);
        await fs.writeFile("/workspace/a.txt", "bravo!");
        return bytes;
      },
    });
    expectFsError(await adapter(racing).open("a.txt", {}), "io", {
      code: "OPEN_CHANGED",
      phase: "open-verify",
    });
  });

  test("verify reports mutation, deletion and final-symlink replacement", async () => {
    const fs = new InMemoryFs({
      "/workspace/a.txt": "alpha",
      "/workspace/other.txt": "other",
    });
    const wrapped = adapter(fs);

    const mutated = opened(await wrapped.open("a.txt", {}));
    await fs.writeFile("/workspace/a.txt", "bravo");
    expect(await mutated.verify()).toEqual({ ok: true, changed: true });
    await mutated.close();

    const deleted = opened(await wrapped.open("other.txt", {}));
    await fs.rm("/workspace/other.txt");
    expect(await deleted.verify()).toEqual({ ok: true, changed: true });
    await deleted.close();

    const linked = opened(await wrapped.open("a.txt", {}));
    await fs.rm("/workspace/a.txt");
    await fs.symlink("/workspace/elsewhere.txt", "/workspace/a.txt");
    expect(await linked.verify()).toEqual({ ok: true, changed: true });
    await linked.close();
  });

  test("shares MountableFs mutations and namespaces colliding child identities", async () => {
    const workspace = new InMemoryFs({ "/a.txt": "alpha\n" });
    const knowledge = new InMemoryFs({ "/guide.txt": "guide\n" });
    const mounted = new MountableFs({
      base: new InMemoryFs({ "/base.txt": "base\n" }),
      mounts: [
        { mountPoint: "/workspace", filesystem: workspace },
        { mountPoint: "/knowledge", filesystem: knowledge },
      ],
    });
    const wrapped = justBashFileSystem(mounted, {
      id: "shared-vfs",
      cwd: "/workspace",
      allowedRoots: ["/workspace", "/knowledge"],
      maxBufferedBytes: 1_024,
      identity: "required",
    });

    const old = opened(await wrapped.open("a.txt", {}));
    const guide = opened(await wrapped.open("/knowledge/guide.txt", {}));
    expect(old.info.identity).not.toBe(guide.info.identity);

    await mounted.writeFile("/workspace/a.txt", "beta\n");
    await mounted.cp("/knowledge/guide.txt", "/workspace/guide.txt");
    expect(await old.verify()).toEqual({ ok: true, changed: true });
    const current = opened(await wrapped.open("guide.txt", {}));
    expect(DECODER.decode(await contents(current))).toBe("guide\n");
    await Promise.all([old.close(), guide.close(), current.close()]);
  });
});

describe("just-bash not-a-file", () => {
  test("a directory reports kind directory and its target", async () => {
    const fs = new InMemoryFs({ "/workspace/dir/a.txt": "a" });
    expect(expectFsError(await adapter(fs).open("dir", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/workspace/dir", displayPath: "dir" },
    });
  });

  test("a directory outside cwd shows its absolute path", async () => {
    const fs = new InMemoryFs({ "/knowledge/dir/a.txt": "a", "/workspace/b.txt": "b" });
    const wrapped = adapter(fs, { allowedRoots: ["/workspace", "/knowledge"] });
    expect(expectFsError(await wrapped.open("/knowledge/dir", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/knowledge/dir", displayPath: "/knowledge/dir" },
    });
  });

  test("a non-file non-directory reports kind other and its target", async () => {
    const fs = new InMemoryFs({ "/workspace/fifo": "x" });
    const special = intercept(fs, {
      stat: async (original, args) => ({
        ...((await original(...args)) as FsStat),
        isFile: false,
        isDirectory: false,
      }),
    });
    expect(expectFsError(await adapter(special).open("fifo", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "other",
      target: { resolvedPath: "/workspace/fifo", displayPath: "fifo" },
    });
  });

  test("a backend EISDIR maps to kind directory without a target", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "a" });
    const racing = intercept(fs, {
      readFileBuffer: () => {
        throw Object.assign(new Error("EISDIR: is a directory"), { code: "EISDIR" });
      },
    });
    expect(expectFsError(await adapter(racing).open("a.txt", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: null,
      cause: { code: "EISDIR", phase: "readFileBuffer" },
    });
  });
});

describe("just-bash imports", () => {
  test("the source imports only @better-fs-tools/fs, types from just-bash and shell, and its own modules", async () => {
    const folder = resolve(import.meta.dir, "../src");
    const specifiers = await sourceSpecifiers(folder);
    expect(new Set(specifiers)).toEqual(
      new Set(["@better-fs-tools/fs", "@better-fs-tools/shell", "just-bash"]),
    );
    for (const file of new Bun.Glob("*.ts").scanSync({ cwd: folder, absolute: true })) {
      const source = await Bun.file(file).text();
      const typeOnly = (text: string) =>
        text.includes('from "just-bash"') || text.includes('} from "@better-fs-tools/shell"');
      for (const line of source.split("\n").filter(typeOnly)) {
        expect(line).toMatch(/^(import type |\} from)/u);
      }
      expect(source).not.toMatch(/^import \{[^}]*\} from "@better-fs-tools\/shell"/mu);
    }
  });
});
