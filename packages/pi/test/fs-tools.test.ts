import { describe, expect, test } from "bun:test";

import { link, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultEditSignature } from "@better-fs-tools/write/signature";

import { nodeDigest } from "@better-fs-tools/node";
import { memoryStore, sha256Digest } from "@better-fs-tools/read";
import { memoryLocks } from "@better-fs-tools/write";

import { createPiBashTool, createPiFsTools } from "../src/index.ts";
import { execute, fixtures, piContext, run, textOf } from "./helpers.ts";
import { piCwdCommandRunner, piCwdFileSystem } from "../src/node.ts";
import { shellEnv } from "@better-fs-tools/shell";

const fixture = fixtures();

const EDIT = (oldText: string, newText: string) => ({
  path: "a.txt",
  old_string: oldText,
  new_string: newText,
});

describe("createPiFsTools", () => {
  test("gives read, edit, and write; apply_patch only on request", () => {
    const tools = createPiFsTools({ fs: piCwdFileSystem() });
    expect([tools.read, tools.edit, tools.write].map((t) => t.name)).toEqual([
      "read",
      "edit",
      "write",
    ]);
    expect(tools.applyPatch).toBeNull();
    expect(Object.isFrozen(tools)).toBe(true);
    expect(createPiFsTools({ fs: piCwdFileSystem(), applyPatch: true }).applyPatch.name).toBe(
      "apply_patch",
    );
    expect(createPiFsTools({ fs: piCwdFileSystem(), applyPatch: false }).applyPatch).toBeNull();
  });

  test("hardLinks: a hard-linked file is written in place by default and refused with refuse", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    await link(path.join(cwd, "a.txt"), path.join(cwd, "twin.txt"));

    const refusing = createPiFsTools({ fs: piCwdFileSystem({ hardLinks: "refuse" }) });
    expect(textOf(await run(refusing.edit, EDIT("one", "1"), cwd))).toContain("hard link");
    expect(await readFile(path.join(cwd, "twin.txt"), "utf8")).toBe("one\n");

    const tools = createPiFsTools({ fs: piCwdFileSystem() });
    expect((await run(tools.edit, EDIT("one", "1"), cwd)).details?.firstChangedLine).toBe(1);
    expect(await readFile(path.join(cwd, "twin.txt"), "utf8")).toBe("1\n");
  });

  test("with a store, edit needs a read, then edits twice without another", async () => {
    const cwd = await fixture({ "a.txt": "one\ntwo\n" });
    const tools = createPiFsTools({ fs: piCwdFileSystem(), state: memoryStore() });

    expect(textOf(await run(tools.edit, EDIT("one", "1"), cwd))).toBe(
      "[edit:not-read] Read a.txt with the read tool before changing it.",
    );
    await execute(tools.read, { path: "a.txt" }, cwd);
    expect((await run(tools.edit, EDIT("one", "1"), cwd)).details?.firstChangedLine).toBe(1);
    expect((await run(tools.edit, EDIT("two", "2"), cwd)).details?.firstChangedLine).toBe(2);
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("1\n2\n");
  });

  test("a memoryStore on the bundle clock expires records", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    let now = Date.parse("2026-09-29T00:00:00.000Z");
    const store = memoryStore({ clock: () => new Date(now) });
    const tools = createPiFsTools({
      fs: piCwdFileSystem(),
      state: store,
      clock: () => new Date(now),
    });
    await execute(tools.read, { path: "a.txt" }, cwd);
    expect(await store.get(path.join(cwd, "a.txt"))).not.toBeNull();
    now += 31 * 60 * 1_000;
    expect(await store.get(path.join(cwd, "a.txt"))).toBeNull();
  });

  test("takes a digest; the default is sha256Digest(), and nodeDigest() is opt-in", async () => {
    expect(createPiFsTools({ fs: piCwdFileSystem() }).digest.id).toBe("sha256");
    const node = nodeDigest();
    expect(createPiFsTools({ fs: piCwdFileSystem(), digest: node }).digest).toBe(node);
    const digest = sha256Digest();
    const tools = createPiFsTools({ fs: piCwdFileSystem(), digest });
    expect(tools.digest).toBe(digest);
    const cwd = await fixture({ "a.txt": "one\n" });
    await execute(tools.read, { path: "a.txt" }, cwd);
    expect((await run(tools.edit, EDIT("one", "1"), cwd)).details?.firstChangedLine).toBe(1);
    expect(() => createPiFsTools({ fs: piCwdFileSystem(), read: { digest } } as never)).toThrow(
      "createPiFsTools read options cannot set digest: set it once at the top level",
    );
  });

  test("a per-call state factory turns read-before-write on", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const store = memoryStore();
    const tools = createPiFsTools({ fs: piCwdFileSystem(), state: () => store });
    await execute(tools.read, { path: "a.txt" }, cwd);
    expect(await store.get(path.join(cwd, "a.txt"))).not.toBeNull();
    expect(() => createPiFsTools({ fs: piCwdFileSystem(), state: {} } as never)).toThrow(
      "createPiFsTools state must be a read state store, a function that returns one, or null",
    );
  });

  test("a change on disk after the read gives STALE for write", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const tools = createPiFsTools({ fs: piCwdFileSystem(), state: memoryStore() });
    await execute(tools.read, { path: "a.txt" }, cwd);
    await writeFile(path.join(cwd, "a.txt"), "changed on disk\n");

    const result = await run(tools.write, { path: "a.txt", content: "mine\n" }, cwd);
    expect(textOf(result)).toMatch(/^\[write:stale\] a\.txt changed since it was last read/u);
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("changed on disk\n");
  });

  test("apply_patch shares the store with read", async () => {
    const cwd = await fixture({ "a.txt": "a\n" });
    const tools = createPiFsTools({
      fs: piCwdFileSystem(),
      state: memoryStore(),
      applyPatch: true,
    });
    const patch = "*** Begin Patch\n*** Update File: a.txt\n@@\n-a\n+A\n*** End Patch";
    expect(textOf(await run(tools.applyPatch, { patch }, cwd))).toMatch(
      /^\[apply_patch:not-read\]/u,
    );
    await execute(tools.read, { path: "a.txt" }, cwd);
    expect(textOf(await run(tools.applyPatch, { patch }, cwd))).toBe(
      "Success. Updated the following files:\nM a.txt",
    );
  });

  test("no store by default: edit needs no read", async () => {
    const cwd = await fixture({ "a.txt": "x\n" });
    const tools = createPiFsTools({ fs: piCwdFileSystem() });
    const result = await run(tools.edit, EDIT("x", "y"), cwd);
    expect(textOf(result)).not.toContain("[edit:");
  });

  test("per-tool options reach their tool", async () => {
    const cwd = await fixture({ "a.txt": "x\n" });
    const tools = createPiFsTools({
      fs: piCwdFileSystem(),
      edit: { signature: defaultEditSignature(), promptSnippet: "Edit" },
      write: { promptGuidelines: [] },
    });
    expect(tools.edit.promptSnippet).toBe("Edit");
    expect(tools.write.promptGuidelines).toEqual([]);
    await execute(tools.read, { path: "a.txt" }, cwd);
    const result = await run(tools.edit, { path: "a.txt", old_string: "x", new_string: "y" }, cwd);
    expect(result.details?.diff).toBe("-1 x\n+1 y");
  });

  test("piCwdFileSystem options apply to every tool of the bundle", async () => {
    const cwd = await fixture({ "real.txt": "real\n" });
    await symlink(path.join(cwd, "real.txt"), path.join(cwd, "link.txt"));
    const tools = createPiFsTools({ fs: piCwdFileSystem({ symlinks: "reject" }) });
    expect(textOf(await execute(tools.read, { path: "link.txt" }, cwd))).toMatch(
      /^\[read:denied\]/u,
    );
    const write = await run(tools.write, { path: "link.txt", content: "x\n" }, cwd);
    expect(textOf(write)).toMatch(/^\[write:denied\]/u);
  });

  test("writes stay inside ctx.cwd", async () => {
    const parent = await fixture({ "inside/.keep": "" });
    const tools = createPiFsTools({ fs: piCwdFileSystem() });
    const result = await run(
      tools.write,
      { path: "../out.txt", content: "x\n" },
      path.join(parent, "inside"),
    );
    expect(textOf(result)).toMatch(/^\[write:outside-allowed-roots\]/u);
  });

  test("fs is required; cwd and allowedRoots are unknown options at the top level and in each tool", () => {
    expect(() => createPiFsTools({} as never)).toThrow(TypeError);
    expect(() => createPiFsTools({ fs: piCwdFileSystem(), cwd: "/" } as never)).toThrow(
      "Unknown createPiFsTools option: cwd",
    );
    for (const tool of ["read", "edit", "write", "applyPatch"]) {
      expect(() =>
        createPiFsTools({ fs: piCwdFileSystem(), [tool]: { allowedRoots: ["/"] } } as never),
      ).toThrow(/tool option: allowedRoots/u);
    }
    expect(() => createPiFsTools(null as never)).toThrow(TypeError);
  });

  test("an unknown top-level key throws TypeError, like the core factories", () => {
    expect(() => createPiFsTools({ fs: piCwdFileSystem(), bogus: true } as never)).toThrow(
      "Unknown createPiFsTools option: bogus",
    );
    expect(() => createPiFsTools({ fs: piCwdFileSystem(), bash: true } as never)).toThrow(
      TypeError,
    );
    expect(() => createPiFsTools({ fs: piCwdFileSystem(), denyRoot: ["/x"] } as never)).toThrow(
      TypeError,
    );
  });

  test("a shared option inside a tool's options throws TypeError", () => {
    for (const tool of ["read", "edit", "write", "applyPatch"]) {
      // read takes no locks, so a locks key there is an unknown read option.
      const keys = ["fs", "state", "digest", "clock", ...(tool === "read" ? [] : ["locks"])];
      for (const key of keys) {
        expect(() =>
          createPiFsTools({ fs: piCwdFileSystem(), [tool]: { [key]: null } } as never),
        ).toThrow(
          `createPiFsTools ${tool} options cannot set ${key}: set it once at the top level`,
        );
      }
    }
  });

  test("exposes state, digest, locks, and clock, and takes locks and clock", () => {
    const locks = memoryLocks();
    const clock = () => new Date("2026-09-29T00:00:00.000Z");
    const state = memoryStore();
    const tools = createPiFsTools({ fs: piCwdFileSystem(), locks, clock, state });
    expect(tools.state).toBe(state);
    expect(tools.digest.id).toBe("sha256");
    expect(tools.locks).toBe(locks);
    expect(tools.clock).toBe(clock);
    expect(createPiFsTools({ fs: piCwdFileSystem() }).state).toBeNull();
    expect(createPiFsTools({ fs: piCwdFileSystem(), state: null }).state).toBeNull();
  });

  test("invalidate without the call reports unsupported: there is no ctx.cwd", async () => {
    const tools = createPiFsTools({ fs: piCwdFileSystem() });
    expect(await tools.invalidate("a.txt")).toMatchObject({
      ok: false,
      phase: "stat",
      error: { reason: "unsupported" },
    });
  });

  test("a bash afterRun hook can invalidate a read record with ctx.call", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const tools = createPiFsTools({ fs: piCwdFileSystem(), state: memoryStore() });
    const bash = createPiBashTool({
      runner: piCwdCommandRunner(),
      env: shellEnv(() => process.env),
      afterRun: [
        {
          id: "invalidate",
          afterRun: async (_outcome, ctx) => {
            const outcome = await tools.invalidate("a.txt", ctx.call);
            expect(outcome).toEqual({
              ok: true,
              resolvedPath: path.join(cwd, "a.txt"),
              recorded: true,
            });
            return {};
          },
        },
      ],
    });
    await execute(tools.read, { path: "a.txt" }, cwd);
    await bash.execute(
      "bash-1",
      { command: "printf 'two\\n' > a.txt" },
      undefined,
      undefined,
      piContext(cwd),
    );
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("two\n");
    expect(textOf(await run(tools.edit, EDIT("two", "2"), cwd))).toBe(
      "[edit:not-read] Read a.txt with the read tool before changing it.",
    );
  });

  test("invalidate follows the call's ctx.cwd", async () => {
    const parent = await fixture({ "a/x.txt": "a\n", "b/x.txt": "b\n" });
    const tools = createPiFsTools({ fs: piCwdFileSystem(), state: memoryStore() });
    await execute(tools.read, { path: "x.txt" }, path.join(parent, "a"));
    const call = { host: piContext(path.join(parent, "b")) };
    expect(await tools.invalidate("x.txt", call)).toMatchObject({ ok: true, recorded: false });
    const other = { host: piContext(path.join(parent, "a")) };
    expect(await tools.invalidate("x.txt", other)).toMatchObject({ ok: true, recorded: true });
  });

  test("bash is on with a runner and an env, and gets the shared digest and clock", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const seen: unknown[] = [];
    const tools = createPiFsTools({
      fs: piCwdFileSystem(),
      bash: {
        runner: piCwdCommandRunner(),
        env: shellEnv(() => process.env),
        promptSnippet: "Run",
        afterRun: [
          {
            id: "spy",
            afterRun: async (_outcome, ctx) => {
              seen.push(ctx.digest);
              return {};
            },
          },
        ],
      },
    });
    expect(tools.bash.name).toBe("bash");
    expect(tools.bash.promptSnippet).toBe("Run");
    const result = await tools.bash.execute(
      "b1",
      { command: "cat a.txt" },
      undefined,
      undefined,
      piContext(cwd),
    );
    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("one");
    expect(seen).toEqual([tools.digest]);
    expect(createPiFsTools({ fs: piCwdFileSystem() }).bash).toBeNull();
    expect(() => createPiFsTools({ fs: piCwdFileSystem(), bash: true } as never)).toThrow(
      "createPiFsTools bash must be an object with a runner and an env",
    );
  });
});
