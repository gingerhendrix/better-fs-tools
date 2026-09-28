import { describe, expect, test } from "bun:test";

import { generateText, isStepCount } from "ai";
import type { JSONSchema7, ToolExecutionOptions } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, textOf } from "@better-fs-tools/read";
import type { ToolCallContext } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";
import { exactMatcher } from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";
import {
  defaultEditSignature,
  defaultPatchSignature,
  defaultWriteSignature,
  freeformPatchSignature,
  multiEditSignature,
  snakeCaseWriteSignature,
} from "@better-fs-tools/write/signature";

import {
  createAiSdkApplyPatchTool,
  createAiSdkEditTool,
  createAiSdkWriteTool,
} from "../src/index.ts";
import type { AiSdkMutationTool } from "../src/index.ts";
import { CLOCK, executeOptions } from "./helpers.ts";

type Host = ToolExecutionOptions<Record<string, unknown>>;

const PATCH = [
  "*** Begin Patch",
  "*** Update File: /a.txt",
  "@@",
  "-alpha",
  "+ALPHA",
  "*** End Patch",
];

function tools(files: Record<string, string> = { "/a.txt": "alpha\nbeta\nalpha\n" }) {
  const fs = memoryFileSystem({ files });
  const state = createMemoryStore();
  const digest = {
    id: "len",
    create() {
      let size = 0;
      return {
        update: (bytes: Uint8Array) => void (size += bytes.byteLength),
        digest: () => `len:${size}`,
      };
    },
    hash: (value: string) => `len:${value.length}`,
  };
  const shared = { fs, state, digest, clock: CLOCK };
  return {
    fs,
    read: createReadTool(shared),
    edit: createAiSdkEditTool<Record<string, unknown>>(shared),
    write: createAiSdkWriteTool<Record<string, unknown>>(shared),
    applyPatch: createAiSdkApplyPatchTool<Record<string, unknown>>(shared),
  };
}

async function validate(tool: AiSdkMutationTool<Record<string, unknown>>, value: unknown) {
  const validator = tool.inputSchema.validate;
  if (validator === undefined) throw new Error("the schema has no validator");
  return await validator(value);
}

describe("ai sdk mutation tools: schema", () => {
  test("each tool uses its default signature's name, description, and schema", async () => {
    const { edit, write, applyPatch } = tools();
    for (const [tool, signature] of [
      [edit, defaultEditSignature()],
      [write, defaultWriteSignature()],
      [applyPatch, defaultPatchSignature()],
    ] as const) {
      expect(tool.strict).toBe(true);
      expect(tool.name).toBe(signature.name);
      expect(tool.description).toBe(signature.description);
      expect(await tool.inputSchema.jsonSchema).toEqual(signature.schema as JSONSchema7);
      expect(Object.isFrozen(tool)).toBe(true);
    }
  });

  test("the default edit signature describes the tool's own matchers", () => {
    const tool = createAiSdkEditTool({ fs: memoryFileSystem(), matchers: [exactMatcher()] });
    expect(tool.description).toBe(defaultEditSignature({ matchers: [exactMatcher()] }).description);
    expect(tool.description).not.toContain("close match");
  });

  test("a freeform signature keeps its JSON schema and has no grammar field", async () => {
    const signature = freeformPatchSignature();
    const tool = createAiSdkApplyPatchTool({ fs: memoryFileSystem(), signature });
    expect(await tool.inputSchema.jsonSchema).toEqual(signature.schema as JSONSchema7);
    expect(Object.keys(tool).sort()).toEqual([
      "description",
      "execute",
      "inputSchema",
      "name",
      "strict",
      "toModelOutput",
    ]);
  });

  test("the validator accepts model input and returns it unchanged", async () => {
    const { edit, write, applyPatch } = tools();
    const input = { path: "a.txt", old_string: "a", new_string: "b", replace_all: true };
    expect(await validate(edit, input)).toEqual({ success: true, value: input });
    expect(await validate(write, { path: "a", content: "" })).toEqual({
      success: true,
      value: { path: "a", content: "" },
    });
    expect((await validate(applyPatch, { patch: PATCH.join("\n") })).success).toBe(true);
  });

  test("the validator refuses canonical names, aliases, and bad values with host names", async () => {
    const { edit, write, applyPatch } = tools();
    const cases: [AiSdkMutationTool<Record<string, unknown>>, unknown, RegExp][] = [
      [edit, { path: "a", edits: [{ oldText: "x", newText: "y" }] }, /Unknown edit input key/u],
      [edit, { path: "a", old_string: "", new_string: "y" }, /old_string must not be empty/u],
      [edit, { file_path: "a", old_string: "x", new_string: "y" }, /Unknown edit input key/u],
      [write, { path: "a", content: 1 }, /content must be a string/u],
      [write, { path: "\0", content: "" }, /path must be a non-blank string/u],
      [applyPatch, { patch: "" }, /patch must be a non-blank string/u],
      [applyPatch, "*** Begin Patch", /apply_patch input must be an object/u],
    ];
    for (const [tool, value, message] of cases) {
      const result = await validate(tool, value);
      if (result.success) throw new Error(`expected a rejection of ${JSON.stringify(value)}`);
      expect(result.error).toBeInstanceOf(TypeError);
      expect(result.error.message).toMatch(message);
    }
  });

  test("the validator runs the core parse with the tool's limits", async () => {
    const edit = createAiSdkEditTool({
      fs: memoryFileSystem(),
      signature: multiEditSignature(),
      limits: { maxEdits: 1 },
    });
    const pair = { oldText: "x", newText: "y" };
    expect((await validate(edit, { path: "a", edits: [pair] })).success).toBe(true);
    const result = await validate(edit, { path: "a", edits: [pair, pair] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toBe("edits must hold at most 1 entries");

    const patch = createAiSdkApplyPatchTool({
      fs: memoryFileSystem(),
      limits: { maxPatchBytes: 8 },
    });
    expect((await validate(patch, { patch: PATCH.join("\n") })).success).toBe(false);
  });
});

describe("ai sdk mutation tools: execute", () => {
  test("edit, write, and apply_patch run against the core with a shared store", async () => {
    const { fs, read, edit, write, applyPatch } = tools();
    const options = executeOptions();

    const before = await edit.execute(
      { path: "/a.txt", old_string: "beta", new_string: "B" },
      options,
    );
    expect(before.error?.code).toBe("NOT_READ");

    await read({ path: "/a.txt" });
    const edited = await edit.execute(
      { path: "/a.txt", old_string: "beta", new_string: "B" },
      options,
    );
    expect(edited.status).toBe("ok");

    const patched = await applyPatch.execute({ patch: PATCH.join("\n") }, options);
    expect(patched.status).toBe("ok");

    const written = await write.execute({ path: "/b.txt", content: "new\n" }, options);
    expect(written.status).toBe("ok");
    expect(new TextDecoder().decode(fs.peek("/a.txt")?.bytes)).toBe("ALPHA\nB\nalpha\n");
    expect(new TextDecoder().decode(fs.peek("/b.txt")?.bytes)).toBe("new\n");
  });

  test("the same ToolExecutionOptions object reaches every extension point as host", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "x\n" } });
    const seen: ToolCallContext<Host>[] = [];
    const deps = {
      fs: (call: ToolCallContext<Host>) => {
        seen.push(call);
        return fs;
      },
      authorize: {
        id: "spy",
        authorize: (_target: unknown, ctx: { call: ToolCallContext<Host> }) => {
          seen.push(ctx.call);
          return { allow: true as const };
        },
      },
    };
    const controller = new AbortController();
    for (const [tool, input] of [
      [createAiSdkWriteTool<Record<string, unknown>>(deps), { path: "/a.txt", content: "y\n" }],
      [
        createAiSdkEditTool<Record<string, unknown>>(deps),
        { path: "/a.txt", old_string: "y", new_string: "z" },
      ],
      [
        createAiSdkApplyPatchTool<Record<string, unknown>>(deps),
        { patch: "*** Begin Patch\n*** Add File: /c.txt\n+c\n*** End Patch" },
      ],
    ] as const) {
      seen.length = 0;
      const options = executeOptions(controller.signal);
      const result = await tool.execute(input, options);
      expect(result.status).toBe("ok");
      expect(seen.length).toBeGreaterThan(1);
      for (const call of seen) {
        expect(call).toBe(seen[0] as ToolCallContext<Host>);
        expect(call.host).toBe(options);
        expect(call.signal).toBe(controller.signal);
        expect(call.callId).toBe(options.toolCallId);
      }
    }
  });

  test("messages use the signature's parameter names", async () => {
    const { read, edit } = tools();
    await read({ path: "/a.txt" });
    const result = await edit.execute(
      { path: "/a.txt", old_string: "alpha", new_string: "A" },
      executeOptions(),
    );
    expect(textOf(result)).toBe(
      "[edit:ambiguous-match] Edit 1: the old_string matches 2 places in /a.txt (lines 1, 3). Add surrounding lines to make it unique, or set replace_all.",
    );

    const snake = createAiSdkWriteTool({
      fs: memoryFileSystem(),
      signature: snakeCaseWriteSignature(),
    });
    const refused = await snake
      .execute({ file_path: "", content: "" }, executeOptions())
      .catch((error: unknown) => error);
    expect(snake.name).toBe("write_file");
    expect(refused).toBeInstanceOf(TypeError);
    expect((refused as TypeError).message).toBe("file_path must be a non-blank string without NUL");
  });

  test("host messages override the signature's", async () => {
    const edit = createAiSdkEditTool({
      fs: memoryFileSystem({ files: { "/a.txt": "a\na\n" } }),
      messages: { param: (name) => `<${name}>` },
    });
    const result = await edit.execute(
      { path: "/a.txt", old_string: "a", new_string: "b" },
      executeOptions(),
    );
    expect(textOf(result)).toContain("the <oldText> matches 2 places");
  });

  test("toModelOutput gives the model text as AI SDK content", async () => {
    const { write } = tools();
    const output = await write.execute({ path: "/n.txt", content: "n\n" }, executeOptions());
    expect(write.toModelOutput({ output })).toEqual({
      type: "content",
      value: [{ type: "text", text: "Created /n.txt (1 line)." }],
    });
  });

  test("non-object options throw TypeError", () => {
    expect(() => createAiSdkEditTool(null as never)).toThrow(TypeError);
    expect(() => createAiSdkWriteTool([] as never)).toThrow(TypeError);
    expect(() => createAiSdkApplyPatchTool("x" as never)).toThrow(TypeError);
  });
});

describe("ai sdk mutation tools: composition", () => {
  test("generateText drives edit with the AI SDK mock model", async () => {
    const { fs, read, edit } = tools();
    await read({ path: "/a.txt" });
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "edit-1",
              toolName: "edit",
              input: JSON.stringify({ path: "/a.txt", old_string: "beta", new_string: "BETA" }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage,
          warnings: [],
        },
        {
          content: [{ type: "text", text: "done" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        },
      ],
    });

    const generated = await generateText({
      model,
      prompt: "Edit /a.txt",
      tools: { [edit.name]: edit },
      stopWhen: isStepCount(2),
    });

    expect(generated.text).toBe("done");
    const output = generated.steps[0]?.toolResults[0]?.output as MutationResult;
    expect(output.status).toBe("ok");
    expect(new TextDecoder().decode(fs.peek("/a.txt")?.bytes)).toBe("alpha\nBETA\nalpha\n");
  });
});
