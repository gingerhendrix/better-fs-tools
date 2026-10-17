import { describe, expect, test } from "bun:test";

import { readFile, stat, symlink } from "node:fs/promises";
import path from "node:path";

import {
  createEditToolDefinition as createBuiltInPiEditTool,
  createWriteToolDefinition as createBuiltInPiWriteTool,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { ToolCallContext } from "@better-fs-tools/read";
import { memoryStore } from "@better-fs-tools/read";
import { exactMatcher } from "@better-fs-tools/write";
import { CODEX_PATCH_GRAMMAR } from "@better-fs-tools/write/patch";
import {
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
} from "@better-fs-tools/write/signature";

import { createPiApplyPatchTool, createPiEditTool, createPiWriteTool } from "../src/index.ts";
import { fixtures, piContext, run, textOf } from "./helpers.ts";
import { piCwdFileSystem } from "../src/node.ts";

const fixture = fixtures();

const PATCH = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

describe("pi write tool shapes", () => {
  test("edit has the shared default signature, with the built-in edit name", () => {
    const tool = createPiEditTool({ fs: piCwdFileSystem() });
    const builtIn = createBuiltInPiEditTool(process.cwd());

    expect(tool.name).toBe(builtIn.name);
    expect(tool.label).toBe("edit");
    expect(tool.promptSnippet).toBe("Edit a text file by replacing text");
    expect(tool.promptGuidelines).toEqual([]);
    expect(tool.description).toBe(defaultEditSignature().description);
    expect(tool.parameters).toEqual(defaultEditSignature().schema as never);
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual([
      "path",
      "old_string",
      "new_string",
      "replace_all",
    ]);
    expect(tool.constrainedSampling).toBeUndefined();
  });

  test("write has the shared default signature, with the built-in write name and keys", () => {
    const tool = createPiWriteTool({ fs: piCwdFileSystem() });
    const builtIn = createBuiltInPiWriteTool(process.cwd());

    expect(tool.name).toBe(builtIn.name);
    expect(tool.promptSnippet).toBe("Create a text file, or replace all of its content");
    expect(tool.promptGuidelines).toEqual([]);
    expect(tool.parameters).toEqual(defaultWriteSignature().schema as never);
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toEqual(
      Object.keys((builtIn.parameters as { properties: object }).properties),
    );
  });

  test("apply_patch defaults to the JSON patch signature, with no constrainedSampling", () => {
    const tool = createPiApplyPatchTool({ fs: piCwdFileSystem() });
    expect(tool.name).toBe("apply_patch");
    expect(tool.description).toBe(defaultPatchSignature().description);
    expect(tool.parameters).toEqual(defaultPatchSignature().schema as never);
    expect(Object.hasOwn(tool, "constrainedSampling")).toBe(false);
  });

  test("a signature with a grammar sets an openai_lark grammar", () => {
    const signature = { ...defaultPatchSignature(), grammar: { lark: CODEX_PATCH_GRAMMAR } };
    const tool = createPiApplyPatchTool({ fs: piCwdFileSystem(), signature });
    expect(tool.description).toBe(signature.description);
    expect(tool.constrainedSampling).toEqual({
      type: "grammar",
      variants: { openai_lark: CODEX_PATCH_GRAMMAR },
    });
    // Pi's grammar tools need an object schema with exactly one required string property.
    const parameters = tool.parameters as {
      type: string;
      required: string[];
      properties: Record<string, { type: string }>;
    };
    expect(parameters.type).toBe("object");
    expect(parameters.required).toEqual(["patch"]);
    expect(parameters.properties[parameters.required[0] as string]?.type).toBe("string");
  });

  test("the default edit signature describes the tool's matchers", () => {
    const tool = createPiEditTool({ fs: piCwdFileSystem(), matchers: [exactMatcher()] });
    expect(tool.description).toBe(defaultEditSignature({ matchers: [exactMatcher()] }).description);
  });

  test("prompt options replace the defaults, and the tools are frozen", () => {
    const tool = createPiWriteTool({
      fs: piCwdFileSystem(),
      promptSnippet: "Write",
      promptGuidelines: ["One."],
    });
    expect(tool.promptSnippet).toBe("Write");
    expect(tool.promptGuidelines).toEqual(["One."]);
    expect(Object.isFrozen(tool)).toBe(true);
  });

  test("fs is required, and cwd and allowedRoots are unknown options, as for read", () => {
    for (const create of [createPiEditTool, createPiWriteTool, createPiApplyPatchTool]) {
      expect(() => create({} as never)).toThrow("fs must be a WritableFileSystem");
      for (const key of ["cwd", "allowedRoots"]) {
        expect(() => create({ fs: piCwdFileSystem(), [key]: "/" } as never)).toThrow(
          new RegExp(`Unknown [a-z_]+ tool option: ${key}`, "u"),
        );
      }
      expect(() => create(null as never)).toThrow(TypeError);
    }
  });
});

describe("pi write tools: execute", () => {
  test("write creates and edit changes a file under ctx.cwd, with Pi details", async () => {
    const cwd = await fixture();
    const write = await run(
      createPiWriteTool({ fs: piCwdFileSystem() }),
      { path: "a.txt", content: "one\ntwo\n" },
      cwd,
    );
    expect(textOf(write)).toBe("Created a.txt (2 lines).");
    expect(write.details).toBeUndefined();

    const edit = await run(
      createPiEditTool({ fs: piCwdFileSystem() }),
      { path: "a.txt", old_string: "two", new_string: "TWO" },
      cwd,
    );
    expect(edit.content[0]?.type).toBe("text");
    expect(edit.details).toEqual({
      diff: "1 one\n-2 two\n+2 TWO".replace(/^/u, " "),
      patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n",
      firstChangedLine: 2,
    });
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("one\nTWO\n");
  });

  test("apply_patch adds and updates files under ctx.cwd", async () => {
    const cwd = await fixture({ "a.txt": "a\n" });
    const result = await run(
      createPiApplyPatchTool({ fs: piCwdFileSystem() }),
      { patch: PATCH("*** Update File: a.txt", "@@", "-a", "+A", "*** Add File: b.txt", "+b") },
      cwd,
    );
    expect(textOf(result)).toBe("Success. Updated the following files:\nM a.txt\nA b.txt");
    expect(result.details?.diff).toBe("a.txt\n-1 a\n+1 A\nb.txt\n+1 b");
    expect(await readFile(path.join(cwd, "b.txt"), "utf8")).toBe("b\n");
  });

  test("writes are confined to ctx.cwd", async () => {
    const parent = await fixture({ "inside/keep.txt": "keep\n", "secret.txt": "secret\n" });
    const inside = path.join(parent, "inside");
    await symlink(path.join(parent, "secret.txt"), path.join(inside, "escape.txt"));

    const write = createPiWriteTool({ fs: piCwdFileSystem() });
    for (const target of ["../made.txt", path.join(parent, "made.txt")]) {
      const result = await run(write, { path: target, content: "x\n" }, inside);
      expect(textOf(result)).toMatch(/^\[write:outside-allowed-roots\]/u);
    }
    const patch = await run(
      createPiApplyPatchTool({ fs: piCwdFileSystem() }),
      { patch: PATCH("*** Add File: ../made.txt", "+x") },
      inside,
    );
    expect(textOf(patch)).toMatch(/^\[apply_patch:outside-allowed-roots\]/u);
    const edit = await run(
      createPiEditTool({ fs: piCwdFileSystem() }),
      { path: "escape.txt", old_string: "secret", new_string: "gone" },
      inside,
    );
    expect(textOf(edit)).toMatch(/^\[edit:(outside-allowed-roots|denied)\]/u);
    expect(await readFile(path.join(parent, "secret.txt"), "utf8")).toBe("secret\n");
    await expect(readFile(path.join(parent, "made.txt"))).rejects.toThrow();
  });

  test("the root follows each call's ctx.cwd", async () => {
    const parent = await fixture({ "a/x.txt": "a\n", "b/x.txt": "b\n" });
    const write = createPiWriteTool({ fs: piCwdFileSystem() });
    await run(write, { path: "x.txt", content: "A\n" }, path.join(parent, "a"));
    await run(write, { path: "x.txt", content: "B\n" }, path.join(parent, "b"));
    expect(await readFile(path.join(parent, "a", "x.txt"), "utf8")).toBe("A\n");
    expect(await readFile(path.join(parent, "b", "x.txt"), "utf8")).toBe("B\n");
  });

  test("newFileMode and newDirectoryMode reach the filesystem of each root", async () => {
    const cwd = await fixture();
    const write = createPiWriteTool({
      fs: piCwdFileSystem({ newFileMode: 0o600, newDirectoryMode: 0o700 }),
    });
    await run(write, { path: "d/x.txt", content: "x\n" }, cwd);
    expect((await stat(path.join(cwd, "d"))).mode & 0o7777).toBe(0o700);
    expect((await stat(path.join(cwd, "d", "x.txt"))).mode & 0o7777).toBe(0o600);
  });

  test("Pi's ctx object is the host, with the signal and tool call id", async () => {
    const cwd = await fixture({ "a.txt": "x\n" });
    const seen: ToolCallContext<ExtensionContext>[] = [];
    const authorize = {
      id: "spy",
      authorize: (_target: unknown, ctx: { call: ToolCallContext<ExtensionContext> }) => {
        seen.push(ctx.call);
        return { allow: true as const };
      },
    };
    const controller = new AbortController();
    for (const [tool, input] of [
      [createPiWriteTool({ fs: piCwdFileSystem(), authorize }), { path: "a.txt", content: "y\n" }],
      [
        createPiEditTool({ fs: piCwdFileSystem(), authorize }),
        { path: "a.txt", old_string: "y", new_string: "z" },
      ],
      [
        createPiApplyPatchTool({ fs: piCwdFileSystem(), authorize }),
        { patch: PATCH("*** Add File: b.txt", "+b") },
      ],
    ] as const) {
      seen.length = 0;
      const ctx = piContext(cwd);
      await tool.execute("call-7", input, controller.signal, undefined, ctx);
      expect(seen.length).toBeGreaterThan(1);
      for (const call of seen) {
        expect(call).toBe(seen[0] as ToolCallContext<ExtensionContext>);
        expect(call.host).toBe(ctx);
        expect(call.signal).toBe(controller.signal);
        expect(call.callId).toBe("call-7");
      }
    }
  });

  test("a tool error is content text with isError and no details, not a throw", async () => {
    const cwd = await fixture({ "a.txt": "a\na\n" });
    const result = await run(
      createPiEditTool({ fs: piCwdFileSystem() }),
      { path: "a.txt", old_string: "a", new_string: "b" },
      cwd,
    );
    expect(textOf(result)).toBe(
      "[edit:ambiguous-match] Edit 1: the old_string matches 2 places in a.txt (lines 1, 2). Add surrounding lines to make it unique, or set replace_all.",
    );
    expect(result.details).toBeUndefined();
    expect(result.isError).toBe(true);
  });

  test("invalid model input throws TypeError that names the parameter", async () => {
    const cwd = await fixture();
    await expect(
      run(
        createPiEditTool({ fs: piCwdFileSystem() }),
        { path: "a.txt", old_string: 1, new_string: "b" },
        cwd,
      ),
    ).rejects.toThrow("old_string must be a string");
  });

  test("with piCwdFileSystem(), a missing ctx.cwd is an extension-failed error result", async () => {
    const tool = createPiWriteTool({ fs: piCwdFileSystem() });
    const result = await tool.execute(
      "x",
      { path: "a", content: "" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toStartWith("[write:extension-failed]");
  });

  test("a given store turns read-before-write on", async () => {
    const cwd = await fixture({ "a.txt": "x\n" });
    const edit = createPiEditTool({ fs: piCwdFileSystem(), state: memoryStore() });
    const result = await run(edit, { path: "a.txt", old_string: "x", new_string: "y" }, cwd);
    expect(textOf(result)).toBe(
      "[edit:not-read] Read a.txt with the read tool before changing it.",
    );
  });
});
