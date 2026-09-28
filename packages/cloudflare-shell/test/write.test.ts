import { describe, expect, test } from "bun:test";

import { isWritableFileSystem } from "@better-fs-tools/fs";
import type { WriteOptions } from "@better-fs-tools/fs";

import { shellWorkspaceFileSystem } from "../src/index.ts";
import type { ShellWorkspaceLike } from "../src/index.ts";
import { ROOT, fakeWorkspace, fsFor } from "./fake-workspace.ts";
import { expectMutationError } from "./helpers.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const CREATE: WriteOptions = { precondition: { kind: "absent" }, createParents: false };
const ANY: WriteOptions = { precondition: { kind: "any" }, createParents: false };

function text(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : DECODER.decode(bytes);
}

function writes(calls: readonly string[]): string[] {
  return calls.filter((call) => /^(writeFileBytes|mkdir|rm):/u.test(call));
}

describe("shell workspace writes: shape", () => {
  test("reports weak write capabilities, remove, and no stage", () => {
    const { fs } = fsFor();
    expect(isWritableFileSystem(fs)).toBe(true);
    expect(fs.writeCapabilities).toEqual({
      atomic: false,
      compareAndSwap: false,
      preserveMode: false,
    });
    expect(typeof fs.remove).toBe("function");
    expect("stage" in fs).toBe(false);
  });

  test("rejects a workspace without the write methods", () => {
    const workspace = fakeWorkspace();
    for (const method of ["writeFileBytes", "mkdir", "rm"] as const) {
      const { [method]: _dropped, ...without } = workspace;
      expect(() =>
        shellWorkspaceFileSystem(without as unknown as ShellWorkspaceLike, { root: ROOT }),
      ).toThrow(new RegExp(`must implement ${method}`, "u"));
    }
  });
});

describe("shell workspace writes: stat", () => {
  test("an existing file has the open() version, no mode and no link count", async () => {
    const { fs } = fsFor({ "/workspace/a.txt": "alpha\n" });
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
      mode: null,
      hardLinks: null,
    });
    expect(outcome.stat.version).toBe(opened.file.info.version ?? "");
  });

  test("a missing path lists its missing parents, outermost first", async () => {
    const { fs } = fsFor({ "/workspace/a.txt": "a\n" });
    const outcome = await fs.stat("new/deeper/x.txt", {});
    expect(outcome).toEqual({
      ok: true,
      stat: {
        exists: false,
        resolvedPath: "/workspace/new/deeper/x.txt",
        displayPath: "new/deeper/x.txt",
        missingDirectories: ["/workspace/new", "/workspace/new/deeper"],
      },
    });
  });

  test("refuses symlinks, directories, escapes, file parents and a missing root", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "a\n", "/workspace/dir/b.txt": "b\n" });
    workspace.link("/workspace/leaf", "/workspace/a.txt");
    workspace.link("/workspace/linked", "/workspace/dir");

    expectMutationError(await fs.stat("leaf", {}), "denied");
    expectMutationError(await fs.stat("linked/b.txt", {}), "denied");
    expectMutationError(await fs.stat("linked/new.txt", {}), "denied");
    expect(await fs.stat("dir", {})).toMatchObject({
      ok: false,
      error: { reason: "not-a-file", kind: "directory" },
    });
    expectMutationError(await fs.stat("/etc/passwd", {}), "outside-allowed-roots");
    expectMutationError(await fs.stat("a.txt/x", {}), "not-found");
    expectMutationError(await fs.stat("x\0y", {}), "dangerous-path");

    const empty = shellWorkspaceFileSystem(fakeWorkspace(), { root: "/missing" });
    expectMutationError(await empty.stat("x.txt", {}), "not-found");
  });
});

describe("shell workspace writes: write", () => {
  test("creates a file, then replaces it under its version", async () => {
    const { workspace, fs } = fsFor();
    const created = await fs.write("a.txt", ENCODER.encode("one\n"), CREATE);
    if (!created.ok) throw new Error(`create failed with ${created.error.reason}`);
    expect(created.file).toMatchObject({
      resolvedPath: "/workspace/a.txt",
      displayPath: "a.txt",
      identity: null,
      size: 4,
      createdDirectories: [],
      atomic: false,
    });
    const version = created.file.version ?? "";
    const replaced = await fs.write("a.txt", ENCODER.encode("two\n"), {
      ...ANY,
      precondition: { kind: "version", version },
    });
    if (!replaced.ok) throw new Error(`replace failed with ${replaced.error.reason}`);
    expect(replaced.file.version).not.toBe(version);
    expect(text(workspace.entries.get("/workspace/a.txt")?.bytes)).toBe("two\n");
  });

  test("checks the precondition before the backend call", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "one\n" });
    expectMutationError(await fs.write("a.txt", ENCODER.encode("x"), CREATE), "exists");
    expectMutationError(
      await fs.write("a.txt", ENCODER.encode("x"), {
        ...ANY,
        precondition: { kind: "version", version: "shell:4:1" },
      }),
      "changed",
    );
    expectMutationError(
      await fs.write("missing.txt", ENCODER.encode("x"), {
        ...ANY,
        precondition: { kind: "version", version: "shell:4:1" },
      }),
      "changed",
    );
    expect(writes(workspace.calls)).toEqual([]);
    expect(text(workspace.entries.get("/workspace/a.txt")?.bytes)).toBe("one\n");
  });

  test("keeps the mime type of a replaced file and leaves Shell's default on a create", async () => {
    const { workspace, fs } = fsFor();
    workspace.put("/workspace/page.md", "old\n", "text/markdown");
    await fs.write("page.md", ENCODER.encode("new\n"), ANY);
    await fs.write("new.md", ENCODER.encode("new\n"), CREATE);
    expect(workspace.entries.get("/workspace/page.md")?.mimeType).toBe("text/markdown");
    expect(workspace.entries.get("/workspace/new.md")?.mimeType).toBe("application/octet-stream");
  });

  test("refuses a missing parent without createParents, and creates and reports it with", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "a\n" });
    expectMutationError(
      await fs.write("new/deeper/x.txt", ENCODER.encode("x"), CREATE),
      "not-found",
    );
    expect(writes(workspace.calls)).toEqual([]);

    const outcome = await fs.write("new/deeper/x.txt", ENCODER.encode("x"), {
      ...CREATE,
      createParents: true,
    });
    if (!outcome.ok) throw new Error(`write failed with ${outcome.error.reason}`);
    expect(outcome.file.createdDirectories).toEqual(["/workspace/new", "/workspace/new/deeper"]);
    expect(workspace.entries.get("/workspace/new/deeper")?.type).toBe("directory");
    expect(writes(workspace.calls)).toEqual([
      "mkdir:/workspace/new",
      "mkdir:/workspace/new/deeper",
      "writeFileBytes:/workspace/new/deeper/x.txt",
    ]);
  });

  test("never writes through a symlink or onto a directory", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "a\n", "/workspace/dir/b.txt": "b\n" });
    workspace.link("/workspace/leaf", "/workspace/a.txt");
    workspace.link("/workspace/linked", "/workspace/dir");
    workspace.link("/workspace/dangling", "/workspace/nowhere.txt");

    expectMutationError(await fs.write("leaf", ENCODER.encode("x"), ANY), "denied");
    expectMutationError(await fs.write("dangling", ENCODER.encode("x"), CREATE), "denied");
    expectMutationError(
      await fs.write("linked/new.txt", ENCODER.encode("x"), { ...CREATE, createParents: true }),
      "denied",
    );
    expectMutationError(await fs.write("dir", ENCODER.encode("x"), ANY), "not-a-file");
    expect(writes(workspace.calls)).toEqual([]);
    expect(workspace.entries.has("/workspace/nowhere.txt")).toBe(false);
  });

  test("refuses bytes above the buffered ceiling as too-large", async () => {
    const workspace = fakeWorkspace();
    const fs = shellWorkspaceFileSystem(workspace, { root: "/", maxBufferedBytes: 4 });
    const error = expectMutationError(
      await fs.write("big.txt", ENCODER.encode("12345"), CREATE),
      "too-large",
    );
    expect(error).toMatchObject({
      limit: 4,
      size: 5,
      detail: "the object exceeds the 4-byte buffered ceiling",
    });
    expect(writes(workspace.calls)).toEqual([]);
  });

  test("maps Shell's message-prefixed errors once and never keeps the message", async () => {
    const { workspace, fs } = fsFor();
    const cases = [
      ["EEXIST: path already exists: /workspace/a.txt", "exists"],
      ["ENOSPC: /workspace/a.txt", "no-space"],
      ["EROFS: /workspace/a.txt", "read-only"],
      ["ENOENT: /workspace/a.txt", "not-found"],
      ["EACCES: /workspace/a.txt", "permission-denied"],
      ["database is locked at /workspace/a.txt", "io"],
    ] as const;
    for (const [message, reason] of cases) {
      workspace.override.writeFileBytes = () => {
        throw new Error(message);
      };
      const error = expectMutationError(
        await fs.write("a.txt", ENCODER.encode("x"), CREATE),
        reason,
      );
      expect(error.cause?.phase).toBe("writeFileBytes");
      expect(JSON.stringify(error)).not.toContain("/workspace/a.txt");
    }
  });

  test("an aborted signal gives aborted before any backend call", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "a\n" });
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
    expect(workspace.calls).toEqual([]);
  });
});

describe("shell workspace writes: remove", () => {
  test("removes under the current version and refuses a stale one", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "one\n" });
    expectMutationError(
      await fs.remove("a.txt", { precondition: { kind: "version", version: "shell:4:1" } }),
      "changed",
    );
    expect(workspace.entries.has("/workspace/a.txt")).toBe(true);

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
        atomic: false,
      },
    });
    expect(workspace.entries.has("/workspace/a.txt")).toBe(false);
  });

  test("refuses a missing file, a symlink and a directory", async () => {
    const { workspace, fs } = fsFor({ "/workspace/a.txt": "a\n", "/workspace/dir/b.txt": "b\n" });
    workspace.link("/workspace/leaf", "/workspace/a.txt");
    const any = { precondition: { kind: "any" } } as const;
    expectMutationError(await fs.remove("missing.txt", any), "not-found");
    expectMutationError(await fs.remove("leaf", any), "denied");
    expectMutationError(await fs.remove("dir", any), "not-a-file");
    expect(writes(workspace.calls)).toEqual([]);
  });
});
