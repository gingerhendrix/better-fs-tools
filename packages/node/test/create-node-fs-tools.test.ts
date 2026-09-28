import { afterAll, describe, expect, test } from "bun:test";

import { link, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { textOf } from "@better-fs-tools/read";
import type { ToolCallContext } from "@better-fs-tools/read";
import { memoryLocks } from "@better-fs-tools/write";
import type { Guard } from "@better-fs-tools/write";

import { createNodeFsTools } from "../src/index.ts";

const roots: string[] = [];

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** A fresh temporary directory with the given files. */
async function workspace(files: Record<string, string> = {}): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-fs-tools-")));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return root;
}

function edit(oldText: string, newText: string) {
  return { path: "app.ts", edits: [{ oldText, newText }] };
}

describe("createNodeFsTools on disk", () => {
  test("read, edit, and edit again without another read", async () => {
    const cwd = await workspace({ "app.ts": "const a = 1;\nconst b = 2;\n" });
    const tools = createNodeFsTools({ cwd });

    expect(errorOf(await tools.edit(edit("a = 1", "a = 10")))?.code).toBe("NOT_READ");
    expect((await tools.read({ path: "app.ts" })).status).toBe("ok");
    expect((await tools.edit(edit("a = 1", "a = 10"))).status).toBe("ok");
    expect((await tools.edit(edit("b = 2", "b = 20"))).status).toBe("ok");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("const a = 10;\nconst b = 20;\n");
  });

  test("invalidate(path) makes the next edit need a read", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    const tools = createNodeFsTools({ cwd });
    await tools.read({ path: "app.ts" });
    await tools.invalidate("app.ts");

    const result = await tools.edit(edit("x", "y"));
    expect(errorOf(result)?.code).toBe("NOT_READ");
    expect(textOf(result)).toBe(
      "[edit:not-read] Read app.ts with the read tool before changing it.",
    );
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("x\n");
  });

  test("invalidate of a missing or refused path does nothing and does not throw", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    const tools = createNodeFsTools({ cwd });
    await tools.read({ path: "app.ts" });
    await tools.invalidate("missing.ts");
    await tools.invalidate("/etc/hostname");
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
    const tools = createNodeFsTools({ cwd, edit: { guards: [racer] } });
    await tools.read({ path: "app.ts" });

    const result = await tools.edit(edit("one", "two"));
    expect(errorOf(result)?.code).toBe("STALE");
    expect(errorOf(result)?.phase).toBe("commit");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("other writer\n");
  });

  test("write needs a whole-file read, then creates and replaces", async () => {
    const cwd = await workspace({ "app.ts": "old\n" });
    const tools = createNodeFsTools({ cwd });

    expect(errorOf(await tools.write({ path: "app.ts", content: "new\n" }))?.code).toBe("NOT_READ");
    expect((await tools.write({ path: "dir/new.md", content: "# New\n" })).status).toBe("ok");
    await tools.read({ path: "app.ts" });
    expect((await tools.write({ path: "app.ts", content: "new\n" })).status).toBe("ok");
    expect(await readFile(join(cwd, "dir", "new.md"), "utf8")).toBe("# New\n");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("new\n");
  });

  test("apply_patch uses the same store: an updated file needs a read first", async () => {
    const cwd = await workspace({ "app.ts": "a\nb\n" });
    const tools = createNodeFsTools({ cwd });
    const patch = ["*** Begin Patch", "*** Update File: app.ts", "@@", "-b", "+B", "*** End Patch"];

    expect(errorOf(await tools.applyPatch({ patch: patch.join("\n") }))?.code).toBe("NOT_READ");
    await tools.read({ path: "app.ts" });
    expect((await tools.applyPatch({ patch: patch.join("\n") })).status).toBe("ok");
    // The patch left a write record, so an edit needs no second read.
    expect((await tools.edit(edit("a", "A"))).status).toBe("ok");
    expect(await readFile(join(cwd, "app.ts"), "utf8")).toBe("A\nB\n");
  });

  test("writes stay inside the allowed roots", async () => {
    const cwd = await workspace();
    const outside = await workspace();
    const tools = createNodeFsTools({ cwd });
    const result = await tools.write({ path: join(outside, "x.txt"), content: "x\n" });
    expect(errorOf(result)?.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  test("hardLinks: a hard-linked file is refused by default and written with in-place", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    await link(join(cwd, "app.ts"), join(cwd, "twin.ts"));

    const refusing = createNodeFsTools({ cwd });
    await refusing.read({ path: "app.ts" });
    expect(errorOf(await refusing.edit(edit("x", "y")))?.code).toBe("DENIED");

    const inPlace = createNodeFsTools({ cwd, hardLinks: "in-place" });
    await inPlace.read({ path: "app.ts" });
    expect((await inPlace.edit(edit("x", "y"))).status).toBe("ok");
    expect(await readFile(join(cwd, "twin.ts"), "utf8")).toBe("y\n");
  });
});

describe("createNodeFsTools sharing", () => {
  test("exposes the shared fs, store, and lock manager", async () => {
    const cwd = await workspace();
    const locks = memoryLocks();
    const tools = createNodeFsTools({ cwd, locks });
    expect(tools.locks).toBe(locks);
    expect(tools.state).not.toBeNull();
    expect(tools.fs.id).toBe("node");
    expect(Object.isFrozen(tools)).toBe(true);
  });

  test("state: null turns read-before-write off, and invalidate is a no-op", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    const tools = createNodeFsTools({ cwd, state: null });
    await tools.invalidate("app.ts");
    const result = await tools.edit(edit("x", "y"));
    expect(result.status).toBe("ok");
    expect(result.notes.map((note) => note.code)).toContain("read-before-write-off");
    expect(tools.state).toBeNull();
  });

  test("one lock manager serializes the write tools", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    const acquired: string[][] = [];
    const inner = memoryLocks();
    const tools = createNodeFsTools({
      cwd,
      state: null,
      locks: {
        id: "spy",
        acquire(keys, options) {
          acquired.push([...keys]);
          return inner.acquire(keys, options);
        },
      },
    });
    await tools.edit(edit("x", "y"));
    await tools.write({ path: "app.ts", content: "z\n" });
    await tools.applyPatch({ patch: "*** Begin Patch\n*** Delete File: app.ts\n*** End Patch" });
    expect(acquired).toEqual([[join(cwd, "app.ts")], [join(cwd, "app.ts")], [join(cwd, "app.ts")]]);
  });

  test("per-tool options pass through with the caller's call object", async () => {
    const cwd = await workspace({ "app.ts": "x\n" });
    const calls: unknown[] = [];
    const tools = createNodeFsTools<{ user: string }>({
      cwd,
      read: {
        authorize: {
          id: "spy",
          authorize: (_target, ctx) => {
            calls.push(ctx.call);
            return { allow: true };
          },
        },
      },
      edit: {
        authorize: {
          id: "spy",
          authorize: (_target, ctx) => {
            calls.push(ctx.call);
            return { allow: true };
          },
        },
      },
    });
    const readCall: ToolCallContext<{ user: string }> = { host: { user: "a" } };
    const editCall: ToolCallContext<{ user: string }> = { host: { user: "b" } };
    await tools.read({ path: "app.ts" }, readCall);
    await tools.edit(edit("x", "y"), editCall);
    expect(calls[0]).toBe(readCall);
    expect(calls.slice(1).every((call) => call === editCall)).toBe(true);
    expect(calls.length).toBeGreaterThan(2);
  });

  test("non-object options throw TypeError", () => {
    expect(() => createNodeFsTools(null as never)).toThrow(TypeError);
  });

  test("an unknown option key throws TypeError, like the core factories", () => {
    expect(() => createNodeFsTools({ bogus: true } as never)).toThrow(
      "Unknown createNodeFsTools option: bogus",
    );
    expect(() => createNodeFsTools({ allowedRoot: ["/tmp"] } as never)).toThrow(TypeError);
  });

  test("a per-tool object that sets a shared dependency throws TypeError", () => {
    expect(() => createNodeFsTools({ read: { state: null } } as never)).toThrow(
      "createNodeFsTools read options cannot set state: set it once at the top level",
    );
    expect(() => createNodeFsTools({ edit: { locks: memoryLocks() } } as never)).toThrow(TypeError);
    expect(() => createNodeFsTools({ write: { digest: null } } as never)).toThrow(TypeError);
    expect(() => createNodeFsTools({ applyPatch: { fs: null } } as never)).toThrow(TypeError);
    expect(() => createNodeFsTools({ read: "x" } as never)).toThrow(TypeError);
  });

  test("an unknown key inside a per-tool object still throws from the core", () => {
    expect(() => createNodeFsTools({ read: { bogus: 1 } } as never)).toThrow(TypeError);
    expect(() => createNodeFsTools({ bash: { bogus: 1 } } as never)).toThrow(TypeError);
  });
});

/** The error of a result, or null when its status is not "error". */
function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
