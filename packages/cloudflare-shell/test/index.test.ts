import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { DEFAULT_MAX_BUFFERED_BYTES, posixPaths } from "@better-fs-tools/fs";
import type { Workspace } from "@cloudflare/shell";

import { cloudflareShellFileSystem } from "../src/index.ts";
import type { CloudflareShellWorkspaceLike } from "../src/index.ts";
import { ROOT, fakeWorkspace, fsFor } from "./fake-workspace.ts";
import type { FakeWorkspace } from "./fake-workspace.ts";
import { expectFsError, sourceSpecifiers } from "./helpers.ts";

const ENCODER = new TextEncoder();

describe("shared root options", () => {
  test("several roots, a cwd, and deny roots", async () => {
    const backend = fakeWorkspace({
      "/workspace/a.txt": "a\n",
      "/shared/b.txt": "b\n",
      "/shared/private/c.txt": "c\n",
      "/other/d.txt": "d\n",
    });
    const fs = cloudflareShellFileSystem(backend, {
      cwd: "/workspace",
      allowedRoots: ["/workspace", "../shared"],
      denyRoots: ["/shared/private"],
    });
    expect(fs.allowedRoots).toEqual(["/workspace", "/shared"]);
    expect(fs.denyRoots).toEqual(["/shared/private"]);

    const inside = await fs.open("a.txt", {});
    expect(inside.ok && inside.file.info.displayPath).toBe("a.txt");
    if (inside.ok) await inside.file.close();
    // A second root: the display path is absolute, since it is outside cwd.
    const shared = await fs.open("../shared/b.txt", {});
    expect(shared.ok && shared.file.info.displayPath).toBe("/shared/b.txt");
    if (shared.ok) await shared.file.close();

    // A deny root is dangerous-path in every adapter, with the root as the detail.
    const denied = await fs.open("/shared/private/c.txt", {});
    expectFsError(denied, "dangerous-path");
    expect(denied.ok ? null : denied.error.detail).toBe("/shared/private");
    expectFsError(await fs.open("/other/d.txt", {}), "outside-allowed-roots");
    const stat = await fs.stat("/shared/private/c.txt", {});
    expect(stat.ok ? null : stat.error.reason).toBe("dangerous-path");
  });

  test("cwd defaults to the first allowed root", () => {
    const fs = cloudflareShellFileSystem(fakeWorkspace(), { allowedRoots: ["/a", "/b"] });
    expect(fs.cwd).toBe("/a");
  });
});

describe("shell workspace options", () => {
  test("rejects a relative cwd, bad roots, unsupported values, an unusable ceiling and a workspace without lstat", () => {
    const workspace = fakeWorkspace();
    for (const options of [
      { cwd: "workspace", allowedRoots: [ROOT] },
      { allowedRoots: [] },
      { allowedRoots: ["/a\0b"] },
      { allowedRoots: [ROOT], symlinks: "follow-within-roots" },
      { allowedRoots: [ROOT], identity: "required" },
    ]) {
      expect(() => cloudflareShellFileSystem(workspace, options as never)).toThrow(TypeError);
    }
    expect(() =>
      cloudflareShellFileSystem(workspace, { allowedRoots: [ROOT], maxBufferedBytes: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      cloudflareShellFileSystem(workspace, { allowedRoots: [ROOT], maxBufferedBytes: 1.5 }),
    ).toThrow(TypeError);

    const { lstat: _dropped, ...withoutLstat } = workspace;
    expect(() =>
      cloudflareShellFileSystem(withoutLstat as unknown as CloudflareShellWorkspaceLike, {
        allowedRoots: [ROOT],
      }),
    ).toThrow(/must implement lstat/u);
    expect(() =>
      cloudflareShellFileSystem(null as unknown as CloudflareShellWorkspaceLike, {
        allowedRoots: [ROOT],
      }),
    ).toThrow(TypeError);
  });

  test("accepts a real Shell Workspace structurally", () => {
    /* Compile-time: `@cloudflare/shell`'s Workspace satisfies the declared surface. */
    const workspace: CloudflareShellWorkspaceLike | null = null as Workspace | null;
    expect(workspace).toBeNull();
  });

  test("advertises a buffered, weakly identified, listable backend", () => {
    const { fs } = fsFor();
    expect(fs.id).toBe("cloudflare-shell");
    expect(fs.capabilities).toEqual({ streaming: false, identity: false });
    expect(typeof fs.list).toBe("function");
    expect(fs.paths).toBe(posixPaths);
    expect(fs.cwd).toBe(ROOT);
    expect(fs.allowedRoots).toEqual([ROOT]);
    expect(fs.denyRoots).toEqual([]);
    expect(fs.symlinks).toBe("reject");
    expect(fs.identity).toBe("none");
    expect(fs.maxBufferedBytes).toBe(DEFAULT_MAX_BUFFERED_BYTES);
  });
});

describe("shell workspace policy", () => {
  test("refuses a path outside the root before touching the workspace", async () => {
    const { workspace, fs } = fsFor({ "/other/secret.txt": "secret\n" });

    for (const path of [
      "/other/secret.txt",
      "../other/secret.txt",
      "/workspace/../other/secret.txt",
    ]) {
      expectFsError(await fs.open(path, {}), "outside-allowed-roots");
    }
    expectFsError(await fs.list("/other", { limit: 4 }), "outside-allowed-roots");
    expect(workspace.calls).toEqual([]);
  });

  test("refuses a NUL path as dangerous", async () => {
    const { workspace, fs } = fsFor();
    expectFsError(await fs.open("/workspace/a\0.txt", {}), "dangerous-path");
    expect(workspace.calls).toEqual([]);
  });

  test("resolves a relative path against the root", async () => {
    const { fs } = fsFor({ "/workspace/dir/b.txt": "beta\n" });
    const opened = await fs.open("dir/b.txt", {});
    if (!opened.ok) throw new Error(`expected a handle, got ${opened.error.reason}`);
    expect(opened.file.info.resolvedPath).toBe("/workspace/dir/b.txt");
    expect(opened.file.info.displayPath).toBe("dir/b.txt");
    await opened.file.close();
  });

  test("refuses a symlinked leaf, parent and root before any byte read", async () => {
    for (const [label, build] of [
      [
        "leaf",
        (workspace: FakeWorkspace) => workspace.link("/workspace/link.txt", "/workspace/real.txt"),
      ],
      ["parent", (workspace: FakeWorkspace) => workspace.link("/workspace/dir", "/workspace/real")],
      ["root", (workspace: FakeWorkspace) => workspace.link("/workspace", "/real")],
    ] as const) {
      const workspace = fakeWorkspace({
        "/workspace/real.txt": "alpha\n",
        "/workspace/real/b.txt": "beta\n",
      });
      build(workspace);
      const fs = cloudflareShellFileSystem(workspace, { allowedRoots: [ROOT] });
      const path = label === "leaf" ? "/workspace/link.txt" : "/workspace/dir/b.txt";

      const error = expectFsError(await fs.open(path, {}), "denied");
      expect(error.detail).toMatch(/symbolic link/u);
      expect(workspace.calls.some((call) => call.startsWith("readFileBytes"))).toBe(false);
      expect(workspace.calls.some((call) => call.startsWith("stat:"))).toBe(false);
    }
  });

  test("refuses a missing component, a missing file and a directory", async () => {
    const { fs } = fsFor({ "/workspace/dir/b.txt": "beta\n" });
    expectFsError(await fs.open("/workspace/missing.txt", {}), "not-found");
    const component = expectFsError(await fs.open("/workspace/nope/b.txt", {}), "not-found");
    expect(component.detail).toMatch(/component/u);
    const throughFile = expectFsError(await fs.open("/workspace/dir/b.txt/c.txt", {}), "not-found");
    expect(throughFile.detail).toMatch(/not a directory/u);
  });

  test("refuses a file that appears between lstat and stat, and one that vanishes", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    workspace.override.stat = null;
    expectFsError(await fs.open("/workspace/a.txt", {}), "not-found");

    delete workspace.override.stat;
    workspace.override.readFileBytes = null;
    const gone = expectFsError(await fs.open("/workspace/a.txt", {}), "not-found");
    expect(gone.detail).toMatch(/disappeared/u);
  });
});

describe("shell workspace not-a-file", () => {
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
    const workspace = fakeWorkspace({ "/a.txt": "alpha\n" });
    const fs = cloudflareShellFileSystem(workspace, { allowedRoots: ["/"] });
    expect(expectFsError(await fs.open("/", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/", displayPath: "/" },
    });
  });

  test("a non-file that stat reports maps to kind other with its target", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    workspace.override.stat = { path: "/workspace/a.txt", type: "symlink", size: 0, updatedAt: 1 };
    expect(expectFsError(await fs.open("a.txt", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "other",
      target: { resolvedPath: "/workspace/a.txt", displayPath: "a.txt" },
    });
  });

  test("a backend EISDIR maps to kind directory without a target", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    workspace.override.readFileBytes = () => {
      throw Object.assign(new Error("is a directory"), { code: "EISDIR" });
    };
    expect(expectFsError(await fs.open("a.txt", {}), "not-a-file")).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: null,
      cause: { code: "EISDIR", phase: "readFileBytes" },
    });
  });
});

describe("shell workspace reads", () => {
  test("reads bytes once, with metadata and a mime hint", async () => {
    const { workspace, fs } = fsFor();
    workspace.put("/workspace/a.txt", "alpha\nbeta\n", "text/plain");

    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error(`expected a handle, got ${opened.error.reason}`);
    expect(opened.file.info).toEqual({
      resolvedPath: "/workspace/a.txt",
      displayPath: "a.txt",
      size: 11,
      mtimeMs: workspace.entries.get("/workspace/a.txt")?.updatedAt ?? 0,
      identity: null,
      mimeType: "text/plain",
      version: `shell:11:${workspace.entries.get("/workspace/a.txt")?.updatedAt ?? 0}`,
    });

    const chunks: Uint8Array[] = [];
    for await (const chunk of opened.file.bytes()) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    expect(new TextDecoder().decode(chunks[0])).toBe("alpha\nbeta\n");
    expect(() => opened.file.bytes()).toThrow(TypeError);
    await opened.file.close();
    await opened.file.close();
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

  test("verify() sees a mutation and a replacement by a symlink", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: false });

    workspace.put("/workspace/a.txt", "alpha again\n");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: true });

    workspace.entries.delete("/workspace/a.txt");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: true });

    workspace.link("/workspace/a.txt", "/workspace/other.txt");
    expect(await opened.file.verify()).toEqual({ ok: true, changed: true });
    await opened.file.close();
  });

  test("verify() reports a backend failure as an error", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const opened = await fs.open("/workspace/a.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    workspace.override.lstat = () => {
      throw Object.assign(new Error("sql"), { code: "EACCES" });
    };
    expectFsError(await opened.file.verify(), "permission-denied", {
      code: "EACCES",
      phase: "lstat",
    });
    await opened.file.close();
  });
});

describe("shell workspace ceilings", () => {
  test("refuses a known size above the ceiling before reading", async () => {
    const { workspace, fs } = fsFor({ "/workspace/big.txt": "0123456789" }, 4);
    const error = expectFsError(await fs.open("/workspace/big.txt", {}), "too-large");
    expect(error).toMatchObject({ limit: 4, size: 10 });
    expect(error.detail).toMatch(/4-byte buffered ceiling/u);
    expect(workspace.calls.some((call) => call.startsWith("readFileBytes"))).toBe(false);
  });

  test("refuses a returned buffer above the ceiling", async () => {
    const { workspace, fs } = fsFor({ "/workspace/liar.txt": "ab" }, 4);
    workspace.override.readFileBytes = ENCODER.encode("0123456789");
    const error = expectFsError(await fs.open("/workspace/liar.txt", {}), "too-large");
    expect(error).toMatchObject({ limit: 4, size: 10 });
    expect(error.detail).toMatch(/returned more than the 4-byte buffered ceiling/u);
  });
});

describe("shell workspace aborts", () => {
  test("refuses an already aborted open and list", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const controller = new AbortController();
    controller.abort();
    expectFsError(await fs.open("/workspace/a.txt", { signal: controller.signal }), "aborted");
    expectFsError(await fs.list("/workspace", { limit: 4, signal: controller.signal }), "aborted");
    expect(workspace.calls).toEqual([]);
  });

  test("reports an abort raised during the uncancellable buffered read", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    const controller = new AbortController();
    let released: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      released = resolve;
    });
    workspace.override.readFileBytes = async () => {
      controller.abort();
      released();
      return ENCODER.encode("alpha\n");
    };

    const opened = await fs.open("/workspace/a.txt", { signal: controller.signal });
    await inFlight;
    expectFsError(opened, "aborted");
    /* The backend call still ran to completion: cancellation is not available. */
    expect(workspace.calls).toContain("readFileBytes:/workspace/a.txt");
  });
});

describe("shell workspace malformed results", () => {
  const cases: [string, Partial<FakeWorkspace["override"]>, string][] = [
    ["a non-object stat", { lstat: 42 }, "neither an entry nor null"],
    [
      "a stat without a path",
      { lstat: { type: "file", size: 1, updatedAt: 1 } },
      "without an absolute path",
    ],
    [
      "an unknown type",
      { lstat: { path: "/workspace/a.txt", type: "socket", size: 1, updatedAt: 1 } },
      "unknown entry type",
    ],
    [
      "a negative size",
      { lstat: { path: "/workspace/a.txt", type: "file", size: -1, updatedAt: 1 } },
      "unusable size",
    ],
    [
      "a fractional size",
      { lstat: { path: "/workspace/a.txt", type: "file", size: 1.5, updatedAt: 1 } },
      "unusable size",
    ],
    [
      "a missing timestamp",
      { lstat: { path: "/workspace/a.txt", type: "file", size: 1 } },
      "modification time",
    ],
    [
      "a non-string mime type",
      { lstat: { path: "/workspace/a.txt", type: "file", size: 1, updatedAt: 1, mimeType: 7 } },
      "mime type",
    ],
    [
      "a mismatched path",
      { lstat: { path: "/workspace/other.txt", type: "file", size: 1, updatedAt: 1 } },
      "different path",
    ],
    ["non-bytes content", { readFileBytes: "alpha" }, "neither bytes nor null"],
  ];

  for (const [label, override, detail] of cases) {
    test(`maps ${label} to a bounded io error`, async () => {
      const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
      Object.assign(workspace.override, override);
      const error = expectFsError(await fs.open("/workspace/a.txt", {}), "io", {
        code: "INVALID_BACKEND_RESULT",
      });
      expect(error.detail).toContain(detail);
    });
  }

  test("maps backend failures once, keeping a bounded code and phase", async () => {
    const cases: [unknown, string, string][] = [
      [Object.assign(new Error("gone"), { code: "ENOENT" }), "not-found", "ENOENT"],
      [Object.assign(new Error("denied"), { code: "EPERM" }), "permission-denied", "EPERM"],
      [Object.assign(new Error("stopped"), { name: "AbortError" }), "aborted", "ABORT_ERR"],
      [new Error("sqlite is unhappy"), "io", "UNKNOWN"],
      [Object.assign(new Error("huge"), { code: "x".repeat(200) }), "io", "UNKNOWN"],
    ];
    for (const [thrown, reason, code] of cases) {
      const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
      workspace.override.lstat = () => {
        throw thrown;
      };
      const error = expectFsError(await fs.open("/workspace/a.txt", {}), reason as "io", {
        code,
        phase: "lstat",
      });
      expect(error.detail === undefined || !error.detail.includes("sqlite")).toBe(true);
    }
  });
});

describe("shell workspace listing", () => {
  test("lists names and types, bounded, with an accurate truncated flag", async () => {
    const { workspace, fs } = fsFor({
      "/workspace/dir/a.txt": "a\n",
      "/workspace/dir/b.txt": "b\n",
      "/workspace/dir/nested/c.txt": "c\n",
    });
    workspace.link("/workspace/dir/link.txt", "/workspace/dir/a.txt");

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

    const whole = cloudflareShellFileSystem(fakeWorkspace({ "/a.txt": "alpha\n" }), {
      allowedRoots: ["/"],
    });
    const top = await whole.list("/", { limit: 4 });
    if (!top.ok) throw new Error(`list failed with ${top.error.reason}`);
    expect(top.entries).toEqual([{ name: "a.txt", type: "file" }]);
  });

  test("refuses a symlinked, missing or non-directory listing target", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
    workspace.link("/workspace/link", "/workspace");
    expectFsError(await fs.list("/workspace/link", { limit: 4 }), "denied");
    expectFsError(await fs.list("/workspace/missing", { limit: 4 }), "not-found");
    /* The memory filesystem's rule: a file is not a directory to list. */
    const file = expectFsError(await fs.list("/workspace/a.txt", { limit: 4 }), "not-found");
    expect(file.detail).toBe("not a directory");
    expectFsError(await fs.list("/workspace", { limit: 0 }), "io");
  });

  test("rejects entries from outside the listed directory", async () => {
    const { workspace, fs } = fsFor({ "/workspace/dir/a.txt": "a\n" });
    workspace.override.readDir = [
      { path: "/workspace/elsewhere.txt", type: "file", size: 1, updatedAt: 1 },
    ];
    const error = expectFsError(await fs.list("/workspace/dir", { limit: 4 }), "io", {
      code: "INVALID_BACKEND_RESULT",
    });
    expect(error.detail).toMatch(/outside the listed directory/u);
  });
});

describe("cloudflare-shell worker safety", () => {
  test("the source imports only @better-fs-tools/fs and its own modules", async () => {
    const specifiers = await sourceSpecifiers(resolve(import.meta.dir, "../src"));
    expect(new Set(specifiers)).toEqual(new Set(["@better-fs-tools/fs"]));
  });
});
