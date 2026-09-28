import { afterAll, describe, expect, test } from "bun:test";

import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FileSystemError, ListOutcome, OpenOutcome } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";

import { createNodeReadTool, nodeFileSystem } from "../src/index.ts";
import type { NodeFileSystemOptions } from "../src/index.ts";

const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-")));
const outside = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-outside-")));

await mkdir(join(root, "src"), { recursive: true });
await writeFile(join(root, "src", "index.ts"), "const a = 1;\nconst b = 2;\n");
await writeFile(join(root, "src", "notes.md"), "# notes\n");
await writeFile(join(outside, "secret.txt"), "secret\n");

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

function toolFor(options: NodeFileSystemOptions = { cwd: root, allowedRoots: [root] }) {
  return createNodeReadTool({ fs: nodeFileSystem(options) });
}

function expectFsError(
  outcome: OpenOutcome | ListOutcome,
  reason: FileSystemError["reason"],
): FileSystemError {
  if (outcome.ok) throw new Error(`expected a ${reason} error, got a successful outcome`);
  expect(outcome.error.reason).toBe(reason);
  return outcome.error;
}

const isRoot = process.getuid?.() === 0;

describe("node filesystem reads", () => {
  test("reads a real file with descriptor-backed metadata", async () => {
    const result = await toolFor()({ path: "src/index.ts" });

    if (result.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(textOf(result)).toBe("1|const a = 1;\n2|const b = 2;");
    expect(result.file.backend).toBe("node");
    expect(result.file.displayPath).toBe("src/index.ts");
    expect(result.file.resolvedPath).toBe(join(root, "src", "index.ts"));
    expect(result.file.identity).toMatch(/^\d+:\d+:\d+:\d+:\d+$/u);
    expect(result.file.version).toBe(result.file.identity);
    expect(result.file.size).toBe(26);
    expect(result.observation?.contentId).toStartWith("sha256:");
    expect(result.notes).toEqual([]);
  });

  test("info.version is the descriptor identity and changes with the bytes", async () => {
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    await writeFile(join(root, "version.txt"), "one\n");
    const first = await fs.open("version.txt", {});
    if (!first.ok) throw new Error("expected a handle");
    expect(first.file.info.version).toBe(first.file.info.identity);
    await first.file.close();
    await writeFile(join(root, "version.txt"), "two, longer\n");
    const second = await fs.open("version.txt", {});
    if (!second.ok) throw new Error("expected a handle");
    expect(second.file.info.version).not.toBe(first.file.info.version);
    await second.file.close();
  });

  test("a missing file suggests real neighbours, with the errno in cause", async () => {
    const result = await toolFor()({ path: "src/index.tsx" });

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("NOT_FOUND");
    expect(result.notes[0]?.data).toEqual({
      cause: { code: "ENOENT", phase: "resolve" },
      suggestions: ["index.ts"],
    });
  });

  test("a directory is refused as not-a-file with kind and target", async () => {
    const result = await toolFor()({ path: "src" });

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("NOT_A_FILE");
    expect(result.notes[0]?.message).toContain("directory");
    expect(result.notes[0]?.data).toEqual({ kind: "directory" });

    const error = expectFsError(
      await nodeFileSystem({ cwd: root, allowedRoots: [root] }).open("src", {}),
      "not-a-file",
    );
    if (error.reason !== "not-a-file") throw new Error("unreachable");
    expect(error.kind).toBe("directory");
    expect(error.target).toEqual({ resolvedPath: join(root, "src"), displayPath: "src" });
  });

  test("a path outside every allowed root is refused", async () => {
    const result = await toolFor()({ path: join(outside, "secret.txt") });

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  test("traversal out of the root is refused", async () => {
    const result = await toolFor()({ path: "../../etc/hosts" });

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  test("a refused namespace is rejected before any filesystem call", async () => {
    const result = await toolFor()({ path: "/dev/null" });

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("DANGEROUS_PATH");
    expect(result.notes[0]?.data?.detail).toBe("/dev");
  });

  test("a symlink escaping the root is refused after resolution", async () => {
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
    const result = await toolFor()({ path: "escape.txt" });

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  test("a symlink inside the root is followed by default and rejected under policy", async () => {
    await symlink(join(root, "src", "index.ts"), join(root, "alias.ts"));

    const followed = await toolFor()({ path: "alias.ts" });
    expect(followed.status).toBe("ok");
    if (followed.status === "ok") {
      expect(followed.file.resolvedPath).toBe(join(root, "src", "index.ts"));
      expect(followed.file.displayPath).toBe("src/index.ts");
    }

    const strict = toolFor({ cwd: root, allowedRoots: [root], symlinks: "reject" });
    const rejected = await strict({ path: "alias.ts" });
    if (rejected.status !== "error") throw new Error("expected error");
    expect(rejected.error.code).toBe("DENIED");
  });

  test("a symlink loop is refused as denied", async () => {
    await symlink(join(root, "loop-b"), join(root, "loop-a"));
    await symlink(join(root, "loop-a"), join(root, "loop-b"));
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const error = expectFsError(await fs.open("loop-a", {}), "denied");
    expect(error.detail).toBe("too many symbolic links");
    expect(error.cause).toEqual({ code: "ELOOP", phase: "resolve" });
  });

  test("an extra deny root is refused", async () => {
    const read = toolFor({ cwd: root, allowedRoots: [root], denyRoots: [join(root, "src")] });
    const result = await read({ path: "src/index.ts" });

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("DANGEROUS_PATH");
  });

  test("a FIFO is refused in milliseconds rather than blocking", async () => {
    const fifo = join(root, "pipe");
    const made = spawnSync("mkfifo", [fifo]);
    if (made.status !== 0) return; // mkfifo unavailable: nothing to assert

    const started = Date.now();
    const result = (await Promise.race([
      toolFor()({ path: "pipe" }),
      new Promise((resolve) => setTimeout(() => resolve({ status: "timeout" }), 2_000)),
    ])) as { status: string; error?: { code: string } };

    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("NOT_A_FILE");
    expect(Date.now() - started).toBeLessThan(2_000);

    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const error = expectFsError(await fs.open("pipe", {}), "not-a-file");
    if (error.reason !== "not-a-file") throw new Error("unreachable");
    expect(error.kind).toBe("fifo");
    expect(error.target?.displayPath).toBe("pipe");
    await rm(fifo, { force: true });
  });

  test("a socket is refused with kind socket", async () => {
    const socketPath = join(root, "server.sock");
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
      const error = expectFsError(await fs.open("server.sock", {}), "not-a-file");
      if (error.reason !== "not-a-file") throw new Error("unreachable");
      expect(error.kind).toBe("socket");
      expect(error.target?.displayPath).toBe("server.sock");
      const result = await toolFor()({ path: "server.sock" });
      if (result.status !== "error") throw new Error("expected error");
      expect(result.error.code).toBe("NOT_A_FILE");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test.skipIf(isRoot)("an unreadable file gives permission-denied with the errno", async () => {
    const locked = join(root, "locked.txt");
    await writeFile(locked, "secret\n");
    await chmod(locked, 0o000);
    try {
      const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
      const error = expectFsError(await fs.open("locked.txt", {}), "permission-denied");
      expect(error.cause).toEqual({ code: "EACCES", phase: "open" });
      expect(error.detail).toBeUndefined();
    } finally {
      await chmod(locked, 0o600);
      await rm(locked, { force: true });
    }
  });

  test("a file rewritten under the handle fails verification", async () => {
    const target = join(root, "mutating.txt");
    await writeFile(target, "before\n");
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const opened = await fs.open("mutating.txt", {});
    if (!opened.ok) throw new Error("expected an open handle");
    try {
      await writeFile(target, "after!!\n");
      const verified = await opened.file.verify();
      expect(verified.ok && verified.changed).toBe(true);
    } finally {
      await opened.file.close();
    }
  });

  test("chunks stay valid after the next chunk is read", async () => {
    const target = join(root, "chunks.txt");
    await writeFile(target, `${"a".repeat(64 * 1024)}${"b".repeat(1024)}`);
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const opened = await fs.open("chunks.txt", {});
    if (!opened.ok) throw new Error("expected an open handle");
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of opened.file.bytes()) chunks.push(chunk);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.every((byte) => byte === 0x61)).toBe(true);
      expect(chunks[1]?.every((byte) => byte === 0x62)).toBe(true);
    } finally {
      await opened.file.close();
      await rm(target, { force: true });
    }
  });

  test("listing is bounded and returns names", async () => {
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const listed = await fs.list?.("src", { limit: 1 });
    if (listed === undefined || !listed.ok) throw new Error("expected a listing");
    expect(listed.entries).toHaveLength(1);
    expect(listed.truncated).toBe(true);
    expect(listed.entries[0]?.name).not.toContain("/");
  });

  test("listing a file gives not-found, as in the memory filesystem", async () => {
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const listed = await fs.list?.("src/index.ts", { limit: 10 });
    if (listed === undefined) throw new Error("expected list()");
    expect(expectFsError(listed, "not-found").cause).toEqual({ code: "ENOTDIR", phase: "list" });
  });

  test("capabilities have no list flag; list presence is the capability", () => {
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    expect(fs.capabilities).toEqual({ streaming: true, identity: true });
    expect(typeof fs.list).toBe("function");
  });

  test("options are validated", () => {
    expect(() => nodeFileSystem({ allowedRoots: [] })).toThrow(TypeError);
    expect(() => nodeFileSystem({ allowedRoots: [""] })).toThrow(TypeError);
    expect(() =>
      nodeFileSystem({ allowedRoots: [root], symlinks: "never" as unknown as "reject" }),
    ).toThrow(TypeError);
  });
});

describe("cancellation against a real descriptor", () => {
  test("an abort during the scan stops the read", async () => {
    const big = join(root, "big.txt");
    await writeFile(big, "line\n".repeat(400_000));
    const controller = new AbortController();
    const pending = toolFor()({ path: "big.txt", limit: 1 }, { signal: controller.signal });
    controller.abort();
    const result = await pending;

    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("ABORTED");
    expect(result.notes.find((entry) => entry.code === "aborted")).toBeDefined();
    await rm(big, { force: true });
  });
});
