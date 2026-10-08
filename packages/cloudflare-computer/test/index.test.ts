import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { posixPaths } from "@better-fs-tools/fs";
import type { Workspace, WorkspaceFilesystemStub } from "@cloudflare/computer";

import { cloudflareComputerFileSystem } from "../src/index.ts";
import type { CloudflareComputerFileSystemLike } from "../src/index.ts";
import { ROOT, fakeComputer, fsError, fsFor, streamOf } from "./fake-computer.ts";
import type { FakeComputer } from "./fake-computer.ts";
import { expectFsError, expectMutationError, externalImportSpecifiers } from "./helpers.ts";

const ENCODER = new TextEncoder();

async function settles<T>(pending: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle`)), 250);
  });
  try {
    return await Promise.race([pending, guard]);
  } finally {
    clearTimeout(timer);
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

describe("shared root options", () => {
  test("several roots, a cwd, and deny roots", async () => {
    const backend = fakeComputer({
      "/workspace/a.txt": "a\n",
      "/shared/b.txt": "b\n",
      "/shared/private/c.txt": "c\n",
      "/other/d.txt": "d\n",
    });
    const fs = cloudflareComputerFileSystem(backend, {
      cwd: "/workspace",
      allowedRoots: ["/workspace", "../shared"],
      denyRoots: ["/shared/private"],
    });
    expect(fs.allowedRoots).toEqual(["/workspace", "/shared"]);
    expect(fs.denyRoots).toEqual(["/shared/private"]);

    const inside = await fs.open("a.txt", {});
    expect(inside.ok && inside.file.info.displayPath).toBe("a.txt");
    if (inside.ok) await inside.file.close();
    const shared = await fs.open("../shared/b.txt", {});
    expect(shared.ok && shared.file.info.displayPath).toBe("/shared/b.txt");
    if (shared.ok) await shared.file.close();

    const denied = await fs.open("/shared/private/c.txt", {});
    expectFsError(denied, "dangerous-path");
    expect(denied.ok ? null : denied.error.detail).toBe("/shared/private");
    expectFsError(await fs.open("/other/d.txt", {}), "outside-allowed-roots");
    const stat = await fs.stat("/shared/private/c.txt", {});
    expect(stat.ok ? null : stat.error.reason).toBe("dangerous-path");
  });

  test("cwd defaults to the first allowed root", () => {
    const fs = cloudflareComputerFileSystem(fakeComputer(), { allowedRoots: ["/a", "/b"] });
    expect(fs.cwd).toBe("/a");
  });
});

describe("computer filesystem options", () => {
  test("rejects a relative cwd, bad roots, unsupported values and a backend missing a read method", () => {
    const backend = fakeComputer();
    for (const options of [
      { cwd: "workspace", allowedRoots: [ROOT] },
      { allowedRoots: [] },
      { allowedRoots: ["/a\0b"] },
      { allowedRoots: [ROOT], symlinks: "follow-within-roots" },
      { allowedRoots: [ROOT], identity: "required" },
    ]) {
      expect(() => cloudflareComputerFileSystem(backend, options as never)).toThrow(TypeError);
    }
    expect(() => cloudflareComputerFileSystem(backend, null as never)).toThrow(TypeError);
    expect(() =>
      cloudflareComputerFileSystem(null as unknown as CloudflareComputerFileSystemLike, {
        allowedRoots: [ROOT],
      }),
    ).toThrow(TypeError);

    for (const method of ["readFile", "stat", "lstat", "readdir"] as const) {
      const partial = { ...backend };
      delete (partial as Record<string, unknown>)[method];
      expect(() =>
        cloudflareComputerFileSystem(partial as unknown as CloudflareComputerFileSystemLike, {
          allowedRoots: [ROOT],
        }),
      ).toThrow(new RegExp(`must implement ${method}`, "u"));
    }
  });

  test("accepts the real local filesystem and the RPC stub structurally", () => {
    /* Compile-time check: both `0.2.1` surfaces satisfy the declared subset. */
    const local: CloudflareComputerFileSystemLike | null = null as Workspace["fs"] | null;
    const stub: CloudflareComputerFileSystemLike | null = null as WorkspaceFilesystemStub | null;
    expect(local).toBeNull();
    expect(stub).toBeNull();
  });

  test("advertises a weakly identified, listable backend", () => {
    const { fs } = fsFor();
    expect(fs.id).toBe("cloudflare-computer");
    expect(fs.capabilities).toEqual({ identity: false });
    expect(typeof fs.list).toBe("function");
    expect(fs.paths).toBe(posixPaths);
    expect(fs.cwd).toBe(ROOT);
    expect(fs.allowedRoots).toEqual([ROOT]);
    expect(fs.denyRoots).toEqual([]);
    expect(fs.symlinks).toBe("reject");
    expect(fs.identity).toBe("none");
  });
});

describe("computer filesystem policy", () => {
  test("refuses a symlink above the allowed root, for reads and writes, with nested roots too", async () => {
    for (const allowedRoots of [["/safe/link/nested"], ["/safe", "/safe/link/nested"]]) {
      const backend = fakeComputer({ "/safe/link/nested/x.txt": "x\n" });
      /* Only the ancestor is a link; the fake still serves the entries below it. */
      backend.entries.set("/safe/link", { type: "symlink", target: "/elsewhere", mtime: 1 });
      const fs = cloudflareComputerFileSystem(backend, { allowedRoots });
      const error = expectFsError(await fs.open("/safe/link/nested/x.txt", {}), "denied");
      expect(error.detail).toMatch(/symbolic link/u);
      expectFsError(await fs.list("/safe/link/nested", { limit: 4 }), "denied");
      expectMutationError(await fs.stat("/safe/link/nested/x.txt", {}), "denied");
      expectMutationError(
        await fs.write("/safe/link/nested/new.txt", ENCODER.encode("n"), {
          precondition: { kind: "absent" },
          createParents: false,
        }),
        "denied",
      );
      expectMutationError(
        await fs.remove("/safe/link/nested/x.txt", {
          precondition: { kind: "any" },
        }),
        "denied",
      );
      expect(backend.calls.filter((call) => /^(readFile|writeFile|mkdir|rm):/u.test(call))).toEqual(
        [],
      );
    }
  });

  test("refuses a path outside the root before any backend call", async () => {
    const { backend, fs } = fsFor({ "/other/secret.txt": "secret\n" });

    for (const path of [
      "/other/secret.txt",
      "../other/secret.txt",
      "/workspace/../other/secret.txt",
    ]) {
      expectFsError(await fs.open(path, {}), "outside-allowed-roots");
    }
    expectFsError(await fs.list("/other", { limit: 4 }), "outside-allowed-roots");
    expect(backend.calls).toEqual([]);
  });

  test("refuses a NUL path as dangerous and an empty path as io", async () => {
    const { backend, fs } = fsFor();
    expectFsError(await fs.open("/workspace/a\0.txt", {}), "dangerous-path");
    expectFsError(await fs.open("", {}), "io");
    expect(backend.calls).toEqual([]);
  });

  test("resolves a relative path against the root", async () => {
    const { fs } = fsFor({ "/workspace/dir/b.txt": "beta\n" });
    const opened = await fs.open("dir/b.txt", {});
    if (!opened.ok) throw new Error(`expected a handle, got ${opened.error.reason}`);
    expect(opened.file.info.resolvedPath).toBe("/workspace/dir/b.txt");
    expect(opened.file.info.displayPath).toBe("dir/b.txt");
    await opened.file.close();
  });

  test("refuses a symlinked leaf, parent and root before stat or readFile", async () => {
    for (const [label, build] of [
      [
        "leaf",
        (backend: FakeComputer) => backend.link("/workspace/link.txt", "/workspace/real.txt"),
      ],
      ["parent", (backend: FakeComputer) => backend.link("/workspace/dir", "/workspace/real")],
      ["root", (backend: FakeComputer) => backend.link("/workspace", "/real")],
    ] as const) {
      const backend = fakeComputer({
        "/workspace/real.txt": "alpha\n",
        "/workspace/real/b.txt": "beta\n",
      });
      build(backend);
      const fs = cloudflareComputerFileSystem(backend, { allowedRoots: [ROOT] });
      const path = label === "leaf" ? "/workspace/link.txt" : "/workspace/dir/b.txt";

      const error = expectFsError(await fs.open(path, {}), "denied");
      expect(error.detail).toMatch(/symbolic link/u);
      expect(backend.calls.some((call) => call.startsWith("readFile:"))).toBe(false);
      expect(backend.calls.some((call) => call.startsWith("stat:"))).toBe(false);
    }
  });

  test("refuses a dangling link and a looping link at lstat", async () => {
    const backend = fakeComputer({ "/workspace/a.txt": "alpha\n" });
    backend.link("/workspace/dangling.txt", "/workspace/gone.txt");
    backend.link("/workspace/loop-a", "/workspace/loop-b");
    backend.link("/workspace/loop-b", "/workspace/loop-a");
    const fs = cloudflareComputerFileSystem(backend, { allowedRoots: [ROOT] });

    for (const path of ["/workspace/dangling.txt", "/workspace/loop-a"]) {
      const error = expectFsError(await fs.open(path, {}), "denied");
      expect(error.detail).toMatch(/symbolic link/u);
    }
    expect(backend.calls.some((call) => call.startsWith("stat:"))).toBe(false);
  });

  test("maps a backend ELOOP to denied", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    backend.override.lstat = () => {
      throw fsError("ELOOP", "too many symbolic links");
    };
    const error = expectFsError(await fs.open("/workspace/a.txt", {}), "denied", {
      code: "ELOOP",
      phase: "lstat",
    });
    expect(error.detail).toMatch(/too many symbolic links/u);
  });

  test("refuses a missing component and a missing file", async () => {
    const { fs } = fsFor({ "/workspace/dir/b.txt": "beta\n" });
    expectFsError(await fs.open("/workspace/missing.txt", {}), "not-found", { code: "ENOENT" });
    const component = expectFsError(await fs.open("/workspace/nope/b.txt", {}), "not-found");
    expect(component.detail).toMatch(/component does not exist/u);
    const throughFile = expectFsError(await fs.open("/workspace/dir/b.txt/c.txt", {}), "not-found");
    expect(throughFile.detail).toMatch(/not a directory/u);
  });

  test("refuses a file that vanishes between lstat and stat", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    backend.override.stat = () => {
      throw fsError("ENOENT", "no such path");
    };
    const error = expectFsError(await fs.open("/workspace/a.txt", {}), "not-found", {
      phase: "stat",
    });
    expect(error.detail).toBeUndefined();
  });
});

describe("computer filesystem not-a-file", () => {
  test("a directory reports kind directory and its target", async () => {
    const { fs } = fsFor({ "/workspace/dir/b.txt": "beta\n" });
    expect(expectFsError(await fs.open("dir", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/workspace/dir", displayPath: "dir" },
    });
  });

  test("the root reports kind directory and its target", async () => {
    const { fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    expect(expectFsError(await fs.open("/workspace", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/workspace", displayPath: "workspace" },
    });
  });

  test("a root of / reports kind directory and its target", async () => {
    const fs = cloudflareComputerFileSystem(fakeComputer({ "/a.txt": "alpha\n" }), {
      allowedRoots: ["/"],
    });
    expect(expectFsError(await fs.open("/", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/", displayPath: "/" },
    });
  });

  test("a non-file that stat reports maps to kind other with its target", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    backend.override.stat = {
      name: "a.txt",
      size: 0,
      mtime: 1,
      isFile: false,
      isDirectory: false,
      isSymbolicLink: true,
    };
    expect(expectFsError(await fs.open("a.txt", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "other",
      target: { resolvedPath: "/workspace/a.txt", displayPath: "a.txt" },
    });
  });

  test("a backend EISDIR maps to kind directory without a target", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    backend.override.readFile = () => {
      throw fsError("EISDIR", "is a directory");
    };
    expect(expectFsError(await fs.open("a.txt", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: null,
      cause: { code: "EISDIR", phase: "readFile" },
    });
  });
});

describe("computer filesystem reads", () => {
  test("streams the file through one single-use iterator", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\nbeta\ngamma\n" });
    backend.chunkSize = 4;

    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error(`expected a handle, got ${opened.error.reason}`);
    expect(opened.file.info).toEqual({
      resolvedPath: "/workspace/a.txt",
      displayPath: "a.txt",
      size: 17,
      mtimeMs: backend.entries.get("/workspace/a.txt")?.mtime ?? 0,
      identity: null,
      mimeType: null,
      version: `computer:17:${backend.entries.get("/workspace/a.txt")?.mtime ?? 0}`,
    });

    const chunks: Uint8Array[] = [];
    for await (const chunk of opened.file.bytes()) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(1);
    expect(new TextDecoder().decode(concat(chunks))).toBe("alpha\nbeta\ngamma\n");
    expect(() => opened.file.bytes()).toThrow(TypeError);
    await opened.file.close();
    await opened.file.close();
  });

  test("calls readFile with exactly one argument", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    for await (const _chunk of opened.file.bytes()) {
      /* drain */
    }
    await opened.file.close();
    expect(backend.readFileArity).toEqual([1]);
  });

  test("an empty file yields no chunk", async () => {
    const { fs } = fsFor({ "/workspace/empty.txt": "" });
    const opened = await fs.open("/workspace/empty.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    const chunks: Uint8Array[] = [];
    for await (const chunk of opened.file.bytes()) chunks.push(chunk);
    expect(chunks).toEqual([]);
    await opened.file.close();
  });

  test("verify() sees a mutation, a removal and a replacement by a symlink", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: false });

    backend.put("/workspace/a.txt", "alpha again\n");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: true });

    backend.entries.delete("/workspace/a.txt");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: true });

    backend.link("/workspace/a.txt", "/workspace/other.txt");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: true });
    await opened.file.close();
  });

  test("verify() reports a backend failure as an error", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    backend.override.lstat = () => {
      throw fsError("EACCES", "denied");
    };
    expectFsError(await opened.file.verify(), "permission-denied", {
      code: "EACCES",
      phase: "lstat",
    });
    await opened.file.close();
  });
});

describe("computer filesystem cancellation", () => {
  test("refuses an already aborted open and list", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const controller = new AbortController();
    controller.abort();
    expectFsError(await fs.open("/workspace/a.txt", { signal: controller.signal }), "aborted");
    expectFsError(await fs.list("/workspace", { limit: 4, signal: controller.signal }), "aborted");
    expect(backend.calls).toEqual([]);
  });

  test("cancels a stream that resolves after the caller aborted", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const controller = new AbortController();
    backend.override.readFile = (path: string) => {
      controller.abort();
      return streamOf(ENCODER.encode("alpha\n"), path, backend.cancelled, 8);
    };

    expectFsError(await fs.open("/workspace/a.txt", { signal: controller.signal }), "aborted");
    await Promise.resolve();
    expect(backend.cancelled).toEqual(["/workspace/a.txt"]);
  });

  test("close() settles when cancellation fails and when it never settles", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });

    backend.override.readFile = () => ({
      getReader: () => ({
        read: async () => ({ done: false, value: ENCODER.encode("alpha\n") }),
        cancel: () => Promise.reject(new Error("cancel exploded")),
        releaseLock: () => {
          throw new Error("releaseLock exploded");
        },
      }),
      cancel: () => Promise.reject(new Error("cancel exploded")),
    });
    const exploding = await fs.open("/workspace/a.txt", {});
    if (!exploding.ok) throw new Error("expected a handle");
    const iterator = exploding.file.bytes()[Symbol.asyncIterator]();
    await iterator.next();
    await settles(exploding.file.close(), "close() after a failing cancel");

    backend.override.readFile = () => ({
      getReader: () => ({
        read: async () => ({ done: false, value: ENCODER.encode("alpha\n") }),
        /* An RPC stub whose peer is gone never answers cancel(). */
        cancel: () => new Promise<void>(() => {}),
        releaseLock: () => {},
      }),
      cancel: () => new Promise<void>(() => {}),
    });
    const hanging = await fs.open("/workspace/a.txt", {});
    if (!hanging.ok) throw new Error("expected a handle");
    await hanging.file.bytes()[Symbol.asyncIterator]().next();
    await settles(hanging.file.close(), "close() over a never-settling cancel");
  });

  test("close() before any read cancels the stream it never handed out", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    await opened.file.close();
    await Promise.resolve();
    expect(backend.cancelled).toEqual(["/workspace/a.txt"]);
  });
});

describe("computer filesystem malformed results", () => {
  const file = { name: "a.txt", size: 1, mtime: 1, isFile: true, isDirectory: false };
  const stats: [string, unknown, string][] = [
    ["a non-object stat", 42, "did not return an entry"],
    ["a null stat", null, "did not return an entry"],
    [
      "a stat without a name",
      { size: 1, mtime: 1, isFile: true, isDirectory: false, isSymbolicLink: false },
      "usable name",
    ],
    ["a mismatched name", { ...file, name: "other.txt", isSymbolicLink: false }, "different path"],
    ["a negative size", { ...file, size: -1, isSymbolicLink: false }, "unusable size"],
    ["a fractional size", { ...file, size: 1.5, isSymbolicLink: false }, "unusable size"],
    [
      "a missing timestamp",
      { name: "a.txt", size: 1, isFile: true, isDirectory: false, isSymbolicLink: false },
      "modification time",
    ],
    [
      "a non-boolean type flag",
      { ...file, isFile: 1, isSymbolicLink: false },
      "unusable isFile flag",
    ],
    [
      "no type flag set",
      { ...file, isFile: false, isSymbolicLink: false },
      "exactly one entry type",
    ],
    [
      "two type flags set",
      { ...file, isDirectory: true, isSymbolicLink: false },
      "exactly one entry type",
    ],
  ];

  for (const [label, value, detail] of stats) {
    test(`maps ${label} to a bounded io error`, async () => {
      const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
      /* Only the target is malformed, so the walk above it still succeeds. */
      backend.override.lstat = (path: string) =>
        path === "/workspace/a.txt" ? value : backend.unoverridden.lstat(path);
      const error = expectFsError(await fs.open("/workspace/a.txt", {}), "io", {
        code: "INVALID_BACKEND_RESULT",
        phase: "lstat",
      });
      expect(error.detail).toContain(detail);
    });
  }

  test("refuses a readFile result that is not a stream", async () => {
    for (const value of [null, 42, { getReader: 1 }, { getReader: () => ({}) }]) {
      const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
      backend.override.readFile = () => value;
      const error = expectFsError(await fs.open("/workspace/a.txt", {}), "io", {
        code: "INVALID_BACKEND_RESULT",
        phase: "readFile",
      });
      expect(error.detail).toContain("did not return a ReadableStream");
    }
  });

  const readers: [string, unknown, string][] = [
    [
      "an unusable reader",
      { getReader: () => ({ cancel: () => {} }), cancel: () => {} },
      "unusable reader",
    ],
    [
      "an invalid iterator result",
      { getReader: () => ({ read: async () => "nope", cancel: () => {} }), cancel: () => {} },
      "invalid result",
    ],
    [
      "a non-Uint8Array chunk",
      {
        getReader: () => ({
          read: async () => ({ done: false, value: "alpha" }),
          cancel: () => {},
        }),
        cancel: () => {},
      },
      "non-Uint8Array chunk",
    ],
  ];

  for (const [label, value, detail] of readers) {
    test(`refuses ${label} while streaming`, async () => {
      const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
      backend.override.readFile = () => value;
      const opened = await fs.open("/workspace/a.txt", {});
      if (!opened.ok) throw new Error(`expected a handle, got ${opened.error.reason}`);
      const iterator = opened.file.bytes()[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toThrow(new RegExp(detail, "u"));
      await opened.file.close();
    });
  }

  test("maps backend failures once, keeping a bounded code and phase", async () => {
    const cases: [unknown, string, string][] = [
      [fsError("ENOENT", "gone"), "not-found", "ENOENT"],
      [fsError("ENOTDIR", "not a directory"), "not-found", "ENOTDIR"],
      [fsError("EISDIR", "is a directory"), "not-a-file", "EISDIR"],
      [fsError("EPERM", "denied"), "permission-denied", "EPERM"],
      [fsError("EINVAL", "Invalid path (null byte)"), "dangerous-path", "EINVAL"],
      [Object.assign(new Error("stopped"), { name: "AbortError" }), "aborted", "ABORT_ERR"],
      [new Error("the durable object is unhappy"), "io", "UNKNOWN"],
      [fsError("x".repeat(200), "huge"), "io", "UNKNOWN"],
    ];
    for (const [thrown, reason, code] of cases) {
      const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
      backend.override.lstat = () => {
        throw thrown;
      };
      const error = expectFsError(await fs.open("/workspace/a.txt", {}), reason as "io", {
        code,
        phase: "lstat",
      });
      expect(error.detail === undefined || !error.detail.includes("durable object")).toBe(true);
    }
  });
});

describe("computer filesystem listing", () => {
  test("lists names and types, bounded, with an accurate truncated flag", async () => {
    const { backend, fs } = fsFor({
      "/workspace/dir/a.txt": "a\n",
      "/workspace/dir/b.txt": "b\n",
      "/workspace/dir/nested/c.txt": "c\n",
    });
    backend.link("/workspace/dir/link.txt", "/workspace/dir/a.txt");

    const all = await fs.list("/workspace/dir", { limit: 10 });
    if (!all.ok) throw new Error(`list failed with ${all.error.reason}`);
    expect(all.entries).toEqual([
      { name: "a.txt", type: "file" },
      { name: "b.txt", type: "file" },
      { name: "link.txt", type: "other" },
      { name: "nested", type: "directory" },
    ]);
    expect(all.truncated).toBe(false);

    const bounded = await fs.list("/workspace/dir", { limit: 2 });
    if (!bounded.ok) throw new Error("list failed");
    expect(bounded.entries.map((entry) => entry.name)).toEqual(["a.txt", "b.txt"]);
    expect(bounded.truncated).toBe(true);
  });

  test("lists the configured root, including a root of /", async () => {
    const { fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const listed = await fs.list("/workspace", { limit: 4 });
    if (!listed.ok) throw new Error(`list failed with ${listed.error.reason}`);
    expect(listed.entries).toEqual([{ name: "a.txt", type: "file" }]);

    const whole = cloudflareComputerFileSystem(fakeComputer({ "/a.txt": "alpha\n" }), {
      allowedRoots: ["/"],
    });
    const top = await whole.list("/", { limit: 4 });
    if (!top.ok) throw new Error(`list failed with ${top.error.reason}`);
    expect(top.entries).toEqual([{ name: "a.txt", type: "file" }]);
  });

  test("refuses a symlinked, missing or non-directory listing target and a bad limit", async () => {
    const { backend, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    backend.link("/workspace/link", "/workspace");
    expectFsError(await fs.list("/workspace/link", { limit: 4 }), "denied");
    expectFsError(await fs.list("/workspace/missing", { limit: 4 }), "not-found");
    const file = expectFsError(await fs.list("/workspace/a.txt", { limit: 4 }), "not-found");
    expect(file.detail).toBe("not a directory");
    expectFsError(await fs.list("/workspace", { limit: 0 }), "io");
  });

  const dirent = { isFile: true, isDirectory: false, isSymbolicLink: false };
  const dirents: [string, unknown, string][] = [
    ["a non-object entry", [7], "not an object"],
    [
      "a foreign parent",
      [{ ...dirent, name: "a.txt", parentPath: "/elsewhere" }],
      "outside the listed directory",
    ],
    [
      "a path as a name",
      [{ ...dirent, name: "sub/a.txt", parentPath: "/workspace/dir" }],
      "usable name",
    ],
    ["a dot name", [{ ...dirent, name: "..", parentPath: "/workspace/dir" }], "usable name"],
    [
      "an unusable type flag",
      [{ ...dirent, name: "a.txt", parentPath: "/workspace/dir", isFile: "yes" }],
      "unusable isFile flag",
    ],
    ["a non-array listing", { length: 1 }, "non-array"],
  ];

  for (const [label, value, detail] of dirents) {
    test(`refuses ${label}`, async () => {
      const { backend, fs } = fsFor({ "/workspace/dir/a.txt": "a\n" });
      backend.override.readdir = value;
      const error = expectFsError(await fs.list("/workspace/dir", { limit: 4 }), "io", {
        code: "INVALID_BACKEND_RESULT",
        phase: "readdir",
      });
      expect(error.detail).toContain(detail);
    });
  }
});

describe("cloudflare-computer worker safety", () => {
  test("the source imports only @better-fs-tools/fs and its own modules", async () => {
    const specifiers = await externalImportSpecifiers(resolve(import.meta.dir, "../src"));
    expect(new Set(specifiers)).toEqual(new Set(["@better-fs-tools/fs"]));
  });
});
