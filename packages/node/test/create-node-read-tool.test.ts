import { afterAll, describe, expect, test } from "bun:test";

import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { createMemoryStore, jsonFormatter, textOf } from "@better-fs-tools/read";
import type { ReadContext, ReadStateStore } from "@better-fs-tools/read";

import { createNodeReadTool, nodeFileSystem } from "../src/index.ts";

const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-tool-")));
await writeFile(join(root, "a.txt"), "one\ntwo\n");

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createNodeReadTool", () => {
  test("with no arguments reads a file under process.cwd()", async () => {
    const read = createNodeReadTool();
    const result = await read({ path: "package.json", limit: 1 });
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.file.backend).toBe("node");
    expect(result.file.resolvedPath).toBe(join(await realpath(process.cwd()), "package.json"));
    expect(result.view.lines[0]?.text).toBe("{");
    expect(result.observation?.contentId).toStartWith("sha256:");
    const bytes = await readFile(join(process.cwd(), "package.json"));
    expect(result.totals.bytes).toBe(bytes.byteLength);
  });

  test("with no arguments refuses a path outside process.cwd()", async () => {
    const result = await createNodeReadTool()({ path: join(root, "a.txt") });
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  test("a given fs replaces the default", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "memory\n" } });
    const result = await createNodeReadTool({ fs })({ path: "/a.txt" });
    expect(textOf(result)).toBe("1|memory");
    expect(result.status === "ok" && result.file.backend).toBe("memory");
    expect(result.status === "ok" && result.observation?.contentId).toStartWith("sha256:");
  });

  test("digest: null turns observations off", async () => {
    const read = createNodeReadTool({
      fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }),
      digest: null,
    });
    const result = await read({ path: "a.txt" });
    expect(result.status === "ok" && result.observation).toBeNull();
  });

  test("other dependencies pass through to the core", async () => {
    const read = createNodeReadTool({
      fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }),
      formatter: jsonFormatter(),
      limits: { maxLines: 1 },
    });
    const result = await read({ path: "a.txt" });
    expect(JSON.parse(textOf(result)).view.lines).toHaveLength(1);
    expect(() => createNodeReadTool({ input: null } as never)).toThrow(
      "Unknown read tool dependency: input",
    );
    expect(() => createNodeReadTool(null as never)).toThrow(TypeError);
  });

  test("records a real observation, and state(call) gets the caller's call object", async () => {
    interface Host {
      readonly session: string;
    }
    const store = createMemoryStore();
    const calls: ReadContext<Host>[] = [];
    const read = createNodeReadTool<Host>({
      fs: nodeFileSystem({ cwd: root, allowedRoots: [root] }),
      state: (call): ReadStateStore => {
        calls.push(call);
        return store;
      },
    });
    const call: ReadContext<Host> = { host: { session: "s1" }, callId: "c1" };
    const result = await read({ path: "a.txt" }, call);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(call);
    const record = await store.get(join(root, "a.txt"));
    expect(record?.observationId).toBe(result.observation?.id as string);
    expect(record?.identity).toBe(result.file.identity);
    expect(JSON.stringify(record)).not.toContain("s1");
  });
});
