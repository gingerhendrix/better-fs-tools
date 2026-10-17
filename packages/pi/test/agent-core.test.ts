import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runToolCall } from "@earendil-works/pi-agent-core";
import type { AgentTool, AgentToolCall } from "@earendil-works/pi-agent-core";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { nodeCommandRunner, nodeFileSystem } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";
import type { JsonObject } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import { CODEX_PATCH_GRAMMAR } from "@better-fs-tools/write/patch";
import { freeformPatchSignature } from "@better-fs-tools/write/signature";

import {
  createAgentCoreApplyPatchTool,
  createAgentCoreBashTool,
  createAgentCoreEditTool,
  createAgentCoreFsTools,
  createAgentCoreReadTool,
  createAgentCoreWriteTool,
} from "../src/agent-core.ts";
import { fixtures } from "./helpers.ts";

const fixture = fixtures();

// pi-ai's AssistantMessage, without a direct pi-ai dependency.
const assistantMessage: Parameters<typeof runToolCall>[1]["assistantMessage"] = {
  role: "assistant",
  content: [],
  api: "openai-responses",
  provider: "openai",
  model: "mock",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse",
  timestamp: 0,
};

/** Runs one call through pi-agent-core: argument validation, execute(), and the outcome. */
function callTool(tools: readonly AgentTool[], name: string, args: JsonObject) {
  const toolCall: AgentToolCall = { type: "toolCall", id: `call-${name}`, name, arguments: args };
  return runToolCall(toolCall, { tools: [...tools], assistantMessage, context: { messages: [] } });
}

function nodeTools(cwd: string) {
  return createAgentCoreFsTools({
    fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
    state: memoryStore(),
    applyPatch: true,
  });
}

describe("createAgentCoreFsTools", () => {
  test("has the shared default signatures and no output schemas", () => {
    const tools = createAgentCoreFsTools({ fs: memoryFileSystem({ files: {} }) });
    expect(tools.tools.map((tool) => tool.name)).toEqual(["read", "edit", "write"]);
    const keys = (tool: { parameters: unknown }) =>
      Object.keys((tool.parameters as { properties: object }).properties);
    expect(keys(tools.read)).toEqual(["path", "offset", "limit"]);
    expect(keys(tools.edit)).toEqual(["path", "old_string", "new_string", "replace_all"]);
    expect(keys(tools.write)).toEqual(["path", "content"]);
    for (const tool of tools.tools) expect(Object.hasOwn(tool, "outputSchema")).toBe(false);
    expect(tools.read.replay).toBe("safe");
    expect(tools.applyPatch).toBeNull();
    expect(tools.bash).toBeNull();
    expect(Object.isFrozen(tools.read)).toBe(true);
  });

  test("read, then edit, through runToolCall", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const { tools } = nodeTools(cwd);

    const read = await callTool(tools, "read", { path: "a.txt" });
    expect(read.isError).toBe(false);
    expect(read.result.content).toEqual([{ type: "text", text: "1|one" }]);

    const edit = await callTool(tools, "edit", {
      path: "a.txt",
      old_string: "one",
      new_string: "two",
    });
    expect(edit.isError).toBe(false);
    expect(edit.result.details).toMatchObject({ diff: "-1 one\n+1 two" });
    expect(await readFile(path.join(cwd, "a.txt"), "utf8")).toBe("two\n");
  });

  test("a tool error is an error outcome, not a throw", async () => {
    const cwd = await fixture({ "a.txt": "one\n" });
    const { tools } = nodeTools(cwd);
    const edit = await callTool(tools, "edit", {
      path: "a.txt",
      old_string: "one",
      new_string: "two",
    });
    expect(edit.isError).toBe(true);
    expect(edit.result.content).toEqual([
      { type: "text", text: expect.stringMatching(/^\[edit:not-read\]/u) },
    ]);
    const missing = await callTool(tools, "read", { path: "missing.txt" });
    expect(missing.isError).toBe(true);
  });

  test("input that fails the schema never reaches the tool", async () => {
    const cwd = await fixture();
    const { tools } = nodeTools(cwd);
    const outcome = await callTool(tools, "write", { path: "a.txt" });
    expect(outcome.isError).toBe(true);
  });

  test("apply_patch uses the JSON patch signature, and the memory filesystem needs no Node", async () => {
    const tools = createAgentCoreFsTools({
      fs: memoryFileSystem({ files: { "/src/a.ts": "export const a = 1;\n" } }),
      applyPatch: true,
    });
    expect(tools.applyPatch?.constrainedSampling).toBeUndefined();
    const outcome = await callTool(tools.tools, "apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: /src/a.ts",
        "@@",
        "-export const a = 1;",
        "+export const a = 2;",
        "*** End Patch",
      ].join("\n"),
    });
    expect(outcome.isError).toBe(false);
    const read = await callTool(tools.tools, "read", { path: "/src/a.ts" });
    expect(read.result.content).toEqual([{ type: "text", text: "1|export const a = 2;" }]);
  });

  test("the freeformPatchSignature preset sets an openai_lark grammar", () => {
    const tools = createAgentCoreFsTools({
      fs: memoryFileSystem(),
      applyPatch: { signature: freeformPatchSignature() },
    });
    expect(tools.applyPatch?.constrainedSampling).toEqual({
      type: "grammar",
      variants: { openai_lark: CODEX_PATCH_GRAMMAR },
    });
  });

  test("bash has the shared default signature; a nonzero exit is an error", async () => {
    const cwd = await fixture();
    const tools = createAgentCoreFsTools({
      fs: nodeFileSystem({ cwd, allowedRoots: [cwd] }),
      bash: { runner: nodeCommandRunner({ cwd }), env: shellEnv(() => process.env) },
    });
    const bash = tools.bash;
    if (bash === null) throw new Error("bash is off");
    expect(Object.keys((bash.parameters as { properties: object }).properties)).toEqual([
      "command",
      "timeout",
      "cwd",
    ]);
    const outcome = await callTool(tools.tools, "bash", { command: "echo hi; exit 2" });
    expect(outcome.isError).toBe(true);
    expect(outcome.result.content[0]).toMatchObject({ text: expect.stringContaining("hi") });
  });

  test("checks its options", () => {
    const fs = memoryFileSystem({ files: {} });
    expect(() => createAgentCoreFsTools({ fs, cwd: "/" } as never)).toThrow(
      "Unknown createAgentCoreFsTools option: cwd",
    );
    expect(() => createAgentCoreFsTools(null as never)).toThrow(TypeError);
    expect(() => createAgentCoreFsTools({ fs, read: { fs } as never })).toThrow(TypeError);
  });

  test("imports no Node module and no Pi package at run time", async () => {
    const source = fileURLToPath(new URL("../src/agent-core.ts", import.meta.url));
    const seen = new Set<string>();
    const runtime: string[] = [];
    const visit = async (file: string): Promise<void> => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = await readFile(file, "utf8");
      // Value imports only: `import type` and `export type` vanish at run time.
      for (const match of text.matchAll(/^(?:import|export) (?!type )[^;]*?from "([^"]+)";/gmsu)) {
        const specifier = match[1]!;
        if (specifier.startsWith("./")) await visit(path.join(path.dirname(file), specifier));
        else runtime.push(specifier);
      }
    };
    await visit(source);
    expect(
      runtime.filter(
        (name) =>
          name.startsWith("node:") ||
          name.includes("pi-coding-agent") ||
          name === "@better-fs-tools/node",
      ),
    ).toEqual([]);
  });
});

describe("agent core single tools", () => {
  test("each factory takes the core options and gives the bundle's tool shape", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\n" } });
    const read = createAgentCoreReadTool({ fs });
    const edit = createAgentCoreEditTool({ fs });
    const write = createAgentCoreWriteTool({ fs });
    const applyPatch = createAgentCoreApplyPatchTool({ fs });
    const bash = createAgentCoreBashTool({
      runner: nodeCommandRunner({ cwd: "/" }),
      env: shellEnv(),
    });
    const bundle = createAgentCoreFsTools({ fs, applyPatch: true });
    for (const [single, bundled] of [
      [read, bundle.read],
      [edit, bundle.edit],
      [write, bundle.write],
      [applyPatch, bundle.applyPatch],
    ] as const) {
      expect(single.name).toBe(bundled.name);
      expect(single.description).toBe(bundled.description);
      expect(single.parameters).toEqual(bundled.parameters);
    }
    expect(read.replay).toBe("safe");
    expect(bash.name).toBe("bash");

    const tools = [read, edit];
    expect((await callTool(tools, "read", { path: "/a.txt" })).isError).toBe(false);
    const changed = await callTool(tools, "edit", {
      path: "/a.txt",
      old_string: "one",
      new_string: "two",
    });
    expect(changed.isError).toBe(false);
  });

  test("fs, runner, and env are required, as in the core tools", () => {
    expect(() => createAgentCoreReadTool({} as never)).toThrow(TypeError);
    expect(() => createAgentCoreEditTool({} as never)).toThrow(TypeError);
    expect(() => createAgentCoreBashTool({ env: shellEnv() } as never)).toThrow(TypeError);
    expect(() => createAgentCoreWriteTool(null as never)).toThrow(
      "agent core write tool options must be an object",
    );
  });
});
