import { describe, expect, test } from "bun:test";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { ToolSet } from "ai";
import { Bash } from "just-bash";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { justBashCommandRunner } from "@better-fs-tools/just-bash";
import { textOf } from "@better-fs-tools/read";
import type { ReadResult } from "@better-fs-tools/read";
import { shellEnv } from "@better-fs-tools/shell";
import type { ShellResult } from "@better-fs-tools/shell";
import type { MutationResult } from "@better-fs-tools/write";

import {
  createAiSdkApplyPatchTool,
  createAiSdkBashTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "../../src/index.ts";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey === "") {
  throw new Error(
    "OPENAI_API_KEY is not set. The e2e tests call OpenAI with strict tools; set OPENAI_API_KEY and run bun run test:e2e.",
  );
}
const modelId = process.env.BFT_E2E_OPENAI_MODEL || "gpt-5.4-mini";
const model = createOpenAI({ apiKey })(modelId);

/**
 * Runs one model turn with `toolName` forced, and returns the tool's output.
 * Fails when the provider refuses the schema, the input does not parse, or the
 * tool throws.
 */
async function callTool(tools: ToolSet, toolName: string, prompt: string): Promise<unknown> {
  const result = await generateText({
    model,
    tools,
    toolChoice: { type: "tool", toolName },
    prompt,
  });
  const step = result.steps[0];
  const errors = step?.content.filter((part) => part.type === "tool-error") ?? [];
  expect(errors).toEqual([]);
  const call = step?.toolCalls[0];
  expect(call?.toolName).toBe(toolName);
  expect(call?.invalid).toBeFalsy();
  const output = step?.toolResults[0]?.output;
  expect(output).toBeDefined();
  return output;
}

function textAt(fs: ReturnType<typeof memoryFileSystem>, path: string): string | null {
  const file = fs.peek(path);
  return file === null ? null : new TextDecoder().decode(file.bytes);
}

describe(`AI SDK strict tools against OpenAI (${modelId})`, () => {
  test("read", async () => {
    const fs = memoryFileSystem({ files: { "/w/notes.txt": "alpha\nbeta\ngamma\n" } });
    const read = createAiSdkReadTool({ fs });
    const output = (await callTool(
      { [read.name]: read },
      read.name,
      "Read the file /w/notes.txt.",
    )) as ReadResult;
    expect(output.status).toBe("ok");
    expect(textOf(output)).toContain("beta");
  });

  test("write", async () => {
    const fs = memoryFileSystem({ directories: ["/w"] });
    const write = createAiSdkWriteTool({ fs });
    const output = (await callTool(
      { [write.name]: write },
      write.name,
      "Create the file /w/hello.txt. Its content is the single line: hello from e2e",
    )) as MutationResult;
    expect(output.status).toBe("ok");
    expect(textAt(fs, "/w/hello.txt")?.trimEnd()).toBe("hello from e2e");
  });

  test("apply_patch", async () => {
    const fs = memoryFileSystem({ files: { "/w/a.txt": "one\ntwo\n" } });
    const applyPatch = createAiSdkApplyPatchTool({ fs });
    const patch = [
      "*** Begin Patch",
      "*** Update File: /w/a.txt",
      "@@",
      " one",
      "-two",
      "+three",
      "*** End Patch",
    ].join("\n");
    const output = (await callTool(
      { [applyPatch.name]: applyPatch },
      applyPatch.name,
      `Apply exactly this patch, unchanged:\n\n${patch}`,
    )) as MutationResult;
    expect(output.status).toBe("ok");
    expect(textAt(fs, "/w/a.txt")).toBe("one\nthree\n");
  });

  test("bash", async () => {
    // just-bash defense in depth cannot patch Bun's module loader, so the tests turn it off.
    const shell = new Bash({
      files: { "/w/data.txt": "3\n4\n" },
      cwd: "/w",
      defenseInDepth: false,
    });
    const bash = createAiSdkBashTool({ runner: justBashCommandRunner(shell), env: shellEnv() });
    const output = (await callTool(
      { [bash.name]: bash },
      bash.name,
      "Run this exact command: cat data.txt",
    )) as ShellResult;
    expect(output.status).toBe("ok");
    expect(output.output?.head).toBe("3\n4");
  });
});
