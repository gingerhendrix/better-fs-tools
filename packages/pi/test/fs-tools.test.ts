import { describe, expect, test } from "bun:test";

import { readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultEditSignature } from "@better-fs-tools/write/signature";

import { createPiFsTools } from "../src/index.ts";
import { execute, fixtures, run, textOf } from "./helpers.ts";

const fixture = fixtures();

const EDIT = (oldText: string, newText: string) => ({
  path: "a.txt",
  edits: [{ oldText, newText }],
});

describe("createPiFsTools", () => {
  test("gives read, edit, write, and apply_patch", () => {
    const tools = createPiFsTools();
    expect([tools.read, tools.edit, tools.write, tools.applyPatch].map((t) => t.name)).toEqual([
      "read",
      "edit",
      "write",
      "apply_patch",
    ]);
    expect(Object.isFrozen(tools)).toBe(true);
  });

  test("one store: edit needs a read, then edits twice without another", async () => {
    const cwd = await fixture({ "a.txt": "one\ntwo\n" });
    const tools = createPiFsTools();

    expect(textOf(await run(tools.edit, EDIT("one", "1"), cwd))).toBe(
      "[edit:not-read] Read a.txt with the read tool before changing it.",
    );
    await execute(tools.read, { path: "a.txt" }, cwd);
    expect((await run(tools.edit, EDIT("one", "1"), cwd)).details?.firstChangedLine).toBe(1);
    expect((await run(tools.edit, EDIT("two", "2"), cwd)).details?.firstChangedLine).toBe(2);
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("1\n2\n");
  });

  test("a change on disk after the read gives STALE for write", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const tools = createPiFsTools();
    await execute(tools.read, { path: "a.txt" }, cwd);
    await writeFile(path.join(cwd, "a.txt"), "changed on disk\n");

    const result = await run(tools.write, { path: "a.txt", content: "mine\n" }, cwd);
    expect(textOf(result)).toMatch(/^\[write:stale\] a\.txt changed since it was last read/u);
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("changed on disk\n");
  });

  test("apply_patch shares the store with read", async () => {
    const cwd = await fixture({ "a.txt": "a\n" });
    const tools = createPiFsTools();
    const patch = "*** Begin Patch\n*** Update File: a.txt\n@@\n-a\n+A\n*** End Patch";
    expect(textOf(await run(tools.applyPatch, { patch }, cwd))).toMatch(
      /^\[apply_patch:not-read\]/u,
    );
    await execute(tools.read, { path: "a.txt" }, cwd);
    expect(textOf(await run(tools.applyPatch, { patch }, cwd))).toBe(
      "Success. Updated the following files:\nM a.txt",
    );
  });

  test("state: null turns read-before-write off for every tool", async () => {
    const cwd = await fixture({ "a.txt": "x\n" });
    const tools = createPiFsTools({ state: null });
    const result = await run(tools.edit, EDIT("x", "y"), cwd);
    expect(textOf(result)).toContain("[edit:read-before-write-off]");
  });

  test("per-tool options reach their tool", async () => {
    const cwd = await fixture({ "a.txt": "x\n" });
    const tools = createPiFsTools({
      edit: { signature: defaultEditSignature(), promptSnippet: "Edit" },
      write: { promptGuidelines: [] },
    });
    expect(tools.edit.promptSnippet).toBe("Edit");
    expect(tools.write.promptGuidelines).toEqual([]);
    await execute(tools.read, { path: "a.txt" }, cwd);
    const result = await run(tools.edit, { path: "a.txt", old_string: "x", new_string: "y" }, cwd);
    expect(result.details?.diff).toBe("-1 x\n+1 y");
  });

  test("root options apply to all four tools", async () => {
    const cwd = await fixture({ "real.txt": "real\n" });
    await symlink(path.join(cwd, "real.txt"), path.join(cwd, "link.txt"));
    const tools = createPiFsTools({ symlinks: "reject" });
    expect(textOf(await execute(tools.read, { path: "link.txt" }, cwd))).toMatch(
      /^\[read:denied\]/u,
    );
    const write = await run(tools.write, { path: "link.txt", content: "x\n" }, cwd);
    expect(textOf(write)).toMatch(/^\[write:denied\]/u);
  });

  test("writes stay inside ctx.cwd", async () => {
    const parent = await fixture({ "inside/.keep": "" });
    const tools = createPiFsTools();
    const result = await run(
      tools.write,
      { path: "../out.txt", content: "x\n" },
      path.join(parent, "inside"),
    );
    expect(textOf(result)).toMatch(/^\[write:outside-allowed-roots\]/u);
  });

  test("fs, cwd, and allowedRoots are refused at the top level and in each tool", () => {
    expect(() => createPiFsTools({ cwd: "/" } as never)).toThrow(
      /Pi fs tool options cannot set cwd/u,
    );
    for (const tool of ["read", "edit", "write", "applyPatch"]) {
      expect(() => createPiFsTools({ [tool]: { allowedRoots: ["/"] } } as never)).toThrow(
        new RegExp(`Pi ${tool} tool options cannot set allowedRoots`, "u"),
      );
    }
    expect(() => createPiFsTools(null as never)).toThrow(TypeError);
  });

  test("an unknown top-level key throws TypeError, like the core factories", () => {
    expect(() => createPiFsTools({ bogus: true } as never)).toThrow(
      "Unknown createPiFsTools option: bogus",
    );
    expect(() => createPiFsTools({ digest: null } as never)).toThrow(TypeError);
    expect(() => createPiFsTools({ denyRoot: ["/x"] } as never)).toThrow(TypeError);
  });

  test("a shared option inside a tool's options throws TypeError", () => {
    for (const tool of ["read", "edit", "write", "applyPatch"]) {
      for (const key of ["state", "digest", "locks", "denyRoots", "symlinks", "hardLinks"]) {
        expect(() => createPiFsTools({ [tool]: { [key]: null } } as never)).toThrow(
          `createPiFsTools ${tool} options cannot set ${key}: set it once at the top level`,
        );
      }
    }
  });
});
