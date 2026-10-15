import { afterAll, describe, expect, test } from "bun:test";

import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memoryStore, textOf } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import { createFsTools } from "@better-fs-tools/write";
import type { FsToolsWithBash, Guard } from "@better-fs-tools/write";

import { nodeCommandRunner, nodeDigest, nodeFileSystem } from "../src/index.ts";

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-fs-tools-")));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return root;
}

/** Node as the filesystem of createFsTools: the files under cwd, and a Node digest. */
function disk(cwd: string) {
  return { fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }), digest: nodeDigest() };
}

function edit(oldText: string, newText: string) {
  return { path: "app.ts", edits: [{ oldText, newText }] };
}

describe("createFsTools over nodeFileSystem", () => {
  test("read, edit, and edit again without another read", async () => {
    const cwd = await workspace({ "app.ts": "const a = 1;\nconst b = 2;\n" });
    const tools = createFsTools({ ...disk(cwd), state: memoryStore() });

    expect(errorOf(await tools.edit(edit("a = 1", "a = 10")))?.code).toBe("NOT_READ");
    expect((await tools.read({ path: "app.ts" })).status).toBe("ok");
    expect((await tools.edit(edit("a = 1", "a = 10"))).status).toBe("ok");
    expect((await tools.edit(edit("b = 2", "b = 20"))).status).toBe("ok");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("const a = 10;\nconst b = 20;\n");
  });

  test("invalidate(path) makes the next edit need a read", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    const tools = createFsTools({ ...disk(cwd), state: memoryStore() });
    await tools.read({ path: "app.ts" });
    expect(await tools.invalidate("app.ts")).toEqual({
      ok: true,
      resolvedPath: join(await realpath(cwd), "app.ts"),
      recorded: true,
    });

    const result = await tools.edit(edit("x", "y"));
    expect(errorOf(result)?.code).toBe("NOT_READ");
    expect(textOf(result)).toBe(
      "[edit:not-read] Read app.ts with the read tool before changing it.",
    );
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("x\n");
  });

  test("invalidate of a missing or refused path reports it and keeps the record", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    const tools = createFsTools({ ...disk(cwd), state: memoryStore() });
    await tools.read({ path: "app.ts" });
    expect(await tools.invalidate("missing.ts")).toMatchObject({ ok: true, recorded: false });
    expect(await tools.invalidate("/etc/hostname")).toMatchObject({
      ok: false,
      phase: "stat",
      error: { reason: "outside-allowed-roots" },
    });
    expect((await tools.edit(edit("x", "y"))).status).toBe("ok");
  });

  test("a disk write between load and commit gives STALE and keeps the other writer's bytes", async () => {
    const cwd = await workspace({ "app.ts": "one\n" });
    const racer: Guard = {
      id: "racer",
      async check() {
        await writeFile(join(cwd, "app.ts"), "other writer\n");
        return { allow: true };
      },
    };
    const tools = createFsTools({ ...disk(cwd), edit: { guards: [racer] } });
    await tools.read({ path: "app.ts" });

    const result = await tools.edit(edit("one", "two"));
    expect(errorOf(result)?.code).toBe("STALE");
    expect(errorOf(result)?.phase).toBe("commit");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("other writer\n");
  });

  test("write needs a whole-file read, then creates and replaces", async () => {
    const cwd = await workspace({ "app.ts": "old\n" });
    const tools = createFsTools({ ...disk(cwd), state: memoryStore() });

    expect(errorOf(await tools.write({ path: "app.ts", content: "new\n" }))?.code).toBe("NOT_READ");
    expect((await tools.write({ path: "dir/new.md", content: "# New\n" })).status).toBe("ok");
    await tools.read({ path: "app.ts" });
    expect((await tools.write({ path: "app.ts", content: "new\n" })).status).toBe("ok");
    expect(await readFile(join(cwd, "dir", "new.md"), "utf8")).toBe("# New\n");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("new\n");
  });

  test("apply_patch uses the same store: an updated file needs a read first", async () => {
    const cwd = await workspace({ "app.ts": "a\nb\n" });
    const tools = createFsTools({ ...disk(cwd), state: memoryStore(), applyPatch: true });
    const patch = ["*** Begin Patch", "*** Update File: app.ts", "@@", "-b", "+B", "*** End Patch"];

    expect(errorOf(await tools.applyPatch({ patch: patch.join("\n") }))?.code).toBe("NOT_READ");
    await tools.read({ path: "app.ts" });
    expect((await tools.applyPatch({ patch: patch.join("\n") })).status).toBe("ok");
    expect((await tools.edit(edit("a", "A"))).status).toBe("ok");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("A\nB\n");
  });

  test("writes stay inside the allowed roots", async () => {
    const cwd = await workspace();
    const outside = await workspace();
    const tools = createFsTools(disk(cwd));
    const result = await tools.write({ path: join(outside, "x.txt"), content: "x\n" });
    expect(errorOf(result)?.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  test("bash runs in the runner cwd with process.env, and an afterRun hook can invalidate", async () => {
    const cwd = await workspace({ "a.txt": "one\n" });
    let tools: FsToolsWithBash | undefined;
    tools = createFsTools({
      ...disk(cwd),
      state: memoryStore(),
      bash: {
        runner: nodeCommandRunner({ cwd }),
        env: shellEnv(() => process.env),
        afterRun: [
          {
            id: "invalidate",
            afterRun: async () => {
              await tools?.invalidate("a.txt");
              return {};
            },
          },
        ],
      },
    });
    await tools.read({ path: "a.txt" });
    const ran = await tools.bash({ command: 'printf "two\\n" > a.txt; pwd; printf "%s" "$HOME"' });
    expect(ran.output?.head).toBe(`${cwd}\n${process.env.HOME}`);
    const result = await tools.edit({ path: "a.txt", edits: [{ oldText: "two", newText: "3" }] });
    expect(errorOf(result)?.code).toBe("NOT_READ");
    expect(await readFile(join(cwd, "a.txt"), "utf8")).toBe("two\n");
  });
});

function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
