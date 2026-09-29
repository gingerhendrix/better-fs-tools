import { describe, expect, test } from "bun:test";

import { generateText, isStepCount } from "ai";
import type { JSONSchema7 } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { JsonObject, ReadResult } from "@better-fs-tools/read";
import { defaultReadSignature, lineRangeSignature } from "@better-fs-tools/read/signature";
import { shellEnv } from "@better-fs-tools/shell";
import type { CommandRunner, RunExit } from "@better-fs-tools/shell";
import { defaultBashSignature } from "@better-fs-tools/shell/signature";
import {
  camelCaseEditSignature,
  freeformPatchSignature,
  multiEditSignature,
  snakeCaseWriteSignature,
} from "@better-fs-tools/write/signature";

import {
  createAiSdkApplyPatchTool,
  createAiSdkBashTool,
  createAiSdkEditTool,
  createAiSdkReadTool,
  createAiSdkWriteTool,
} from "../src/index.ts";
import { fromStrictInput, toStrictSchema } from "../src/strict.ts";
import { executeOptions } from "./helpers.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const runner: CommandRunner = {
  id: "echo",
  cwd: "/w",
  run(request) {
    const exit: Promise<RunExit> = Promise.resolve({ code: 0, signal: null });
    const bytes = new TextEncoder().encode(`${request.command}\n`);
    return {
      exit,
      output: (async function* () {
        yield { stream: "stdout" as const, bytes };
      })(),
    };
  },
};

/** Every tool with every shipped signature preset, as the AI SDK tool set a host would pass. */
function allTools() {
  const fs = memoryFileSystem();
  return {
    read: createAiSdkReadTool({ fs }),
    read_renamed: createAiSdkReadTool({
      fs,
      signature: defaultReadSignature({ name: "read_renamed", names: { path: "file_path" } }),
    }),
    read_range: createAiSdkReadTool({
      fs,
      signature: lineRangeSignature({ name: "read_range" }),
    }),
    edit: createAiSdkEditTool({ fs }),
    edit_camel: createAiSdkEditTool({
      fs,
      signature: camelCaseEditSignature({ name: "edit_camel" }),
    }),
    edit_multi: createAiSdkEditTool({ fs, signature: multiEditSignature({ name: "edit_multi" }) }),
    write: createAiSdkWriteTool({ fs }),
    write_snake: createAiSdkWriteTool({
      fs,
      signature: snakeCaseWriteSignature({ name: "write_snake" }),
    }),
    apply_patch: createAiSdkApplyPatchTool({ fs }),
    apply_patch_freeform: createAiSdkApplyPatchTool({
      fs,
      signature: freeformPatchSignature({ name: "apply_patch_freeform" }),
    }),
    bash: createAiSdkBashTool({ runner, env: shellEnv() }),
    bash_seconds: createAiSdkBashTool({
      runner,
      env: shellEnv(),
      signature: defaultBashSignature({ name: "bash_seconds", timeoutUnit: "s", cwd: false }),
    }),
  };
}

/**
 * OpenAI strict function schema rules that this adapter owns: every object has
 * `additionalProperties: false` and lists every property in `required`, at
 * every level. Returns the breaches with their JSON path.
 */
function strictBreaches(schema: unknown, at = "$"): string[] {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return [];
  const node = schema as Record<string, unknown>;
  const breaches: string[] = [];
  const properties = node.properties as Record<string, unknown> | undefined;
  if (node.type === "object" || properties !== undefined) {
    if (node.additionalProperties !== false) breaches.push(`${at}: additionalProperties`);
    const required = (node.required ?? []) as string[];
    for (const key of Object.keys(properties ?? {})) {
      if (!required.includes(key)) breaches.push(`${at}.${key}: not required`);
    }
  }
  for (const [key, child] of Object.entries(properties ?? {})) {
    breaches.push(...strictBreaches(child, `${at}.${key}`));
  }
  breaches.push(...strictBreaches(node.items, `${at}[]`));
  for (const [index, child] of ((node.anyOf ?? []) as unknown[]).entries()) {
    breaches.push(...strictBreaches(child, `${at}|${index}`));
  }
  return breaches;
}

describe("strict provider schema", () => {
  test("every tool the AI SDK sends meets the strict rules at every level", async () => {
    const tools = allTools();
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    });

    await generateText({ model, prompt: "hi", tools });

    const sent = model.doGenerateCalls[0]?.tools ?? [];
    expect(sent.map((tool) => tool.name).sort()).toEqual(Object.keys(tools).sort());
    for (const tool of sent) {
      if (tool.type !== "function") throw new Error(`unexpected tool type ${tool.type}`);
      expect(tool.strict).toBe(true);
      expect({ tool: tool.name, breaches: strictBreaches(tool.inputSchema) }).toEqual({
        tool: tool.name,
        breaches: [],
      });
    }
  });

  test("an optional property becomes required and nullable; a required one does not", () => {
    const schema = toStrictSchema(defaultReadSignature().schema, "read") as JSONSchema7;
    const properties = schema.properties as Record<string, JSONSchema7>;
    expect(schema.required).toEqual(["path", "offset", "limit"]);
    expect(properties.path?.type).toBe("string");
    expect(properties.offset?.type).toEqual(["integer", "null"]);
    expect(properties.limit?.type).toEqual(["integer", "null"]);
    expect(Object.isFrozen(schema)).toBe(true);
  });

  test("a property with no type is wrapped in anyOf with null, keeping its description", () => {
    const schema = toStrictSchema(
      {
        type: "object",
        properties: { mode: { enum: ["a", "b"], description: "The mode." } },
        required: [],
      },
      "t",
    );
    expect(schema.properties).toEqual({
      mode: { description: "The mode.", anyOf: [{ enum: ["a", "b"] }, { type: "null" }] },
    });
  });

  test("an optional enum or const takes null too, so the model can say absent", () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\n" } });
    const base = defaultReadSignature();
    const signature = {
      ...base,
      schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          mode: { type: "string", enum: ["text", "raw"] },
          kind: { type: "string", const: "file" },
        },
        required: ["path"],
      },
    };
    const read = createAiSdkReadTool({ fs, signature });
    const properties = (read.inputSchema.jsonSchema as JSONSchema7).properties as Record<
      string,
      JSONSchema7
    >;
    expect(properties.mode).toEqual({ type: ["string", "null"], enum: ["text", "raw", null] });
    expect(properties.kind).toEqual({ type: ["string", "null"], enum: ["file", null] });
    expect(fromStrictInput(signature.schema, { path: "/a.txt", mode: null, kind: null })).toEqual({
      path: "/a.txt",
    });
    // The custom signature's own schema is not changed or frozen.
    expect(Object.isFrozen(signature.schema.properties.mode)).toBe(false);
  });

  test("objects inside anyOf, oneOf, allOf, and $defs are made strict", () => {
    const edit: JsonObject = {
      type: "object",
      properties: { old: { type: "string" }, note: { type: "string" } },
      required: ["old"],
    };
    const schema: JsonObject = {
      type: "object",
      $defs: { edit },
      properties: {
        choice: { anyOf: [edit, { type: "string" }] },
        one: { oneOf: [{ $ref: "#/$defs/edit" }, { type: "integer" }] },
        both: { allOf: [edit, { description: "An edit." }] },
        list: { type: "array", items: { $ref: "#/$defs/edit" } },
      },
      required: ["choice", "one", "both", "list"],
    };
    const strict = toStrictSchema(schema, "custom");
    expect(strictBreaches(strict)).toEqual([]);
    const closed: JsonObject = {
      type: "object",
      properties: { old: { type: "string" }, note: { type: ["string", "null"] } },
      required: ["old", "note"],
      additionalProperties: false,
    };
    expect((strict.$defs as Record<string, unknown>).edit).toEqual(closed);
    const properties = strict.properties as Record<string, JsonObject & JSONSchema7>;
    expect(properties.choice?.anyOf?.[0]).toEqual(closed);
    expect(properties.both?.allOf?.[0]).toEqual(closed);
    expect(properties.one?.oneOf?.[0]).toEqual({ $ref: "#/$defs/edit" });

    const model = {
      choice: { old: "a", note: null },
      one: { old: "b", note: null },
      both: { old: "c", note: null },
      list: [
        { old: "d", note: null },
        { old: "e", note: "kept" },
      ],
    };
    expect(fromStrictInput(schema, model)).toEqual({
      choice: { old: "a" },
      one: { old: "b" },
      both: { old: "c" },
      list: [{ old: "d" }, { old: "e", note: "kept" }],
    });
    expect(fromStrictInput(schema, { ...model, choice: "text", one: 3 })).toMatchObject({
      choice: "text",
      one: 3,
    });
  });

  test("an optional $ref or anyOf is wrapped in anyOf with null", () => {
    const strict = toStrictSchema(
      {
        type: "object",
        $defs: { mode: { type: "string" } },
        properties: {
          mode: { $ref: "#/$defs/mode" },
          either: { anyOf: [{ type: "string" }, { type: "integer" }] },
        },
      },
      "t",
    );
    expect(strict.properties).toEqual({
      mode: { anyOf: [{ $ref: "#/$defs/mode" }, { type: "null" }] },
      either: { anyOf: [{ anyOf: [{ type: "string" }, { type: "integer" }] }, { type: "null" }] },
    });
  });

  test("a form strict mode cannot express throws a TypeError with the tool and path", () => {
    const cases: [unknown, string][] = [
      [{ type: "object", properties: { a: { not: { type: "string" } } } }, "#/properties/a/not"],
      [{ type: "object", properties: {}, additionalProperties: true }, "#/additionalProperties"],
      [{ type: "object", properties: { a: { type: "object" } } }, "#/properties/a"],
      [
        { type: "object", properties: { a: { type: "array", items: [{ type: "string" }] } } },
        "#/properties/a/items",
      ],
      [
        { type: "object", properties: { a: { patternProperties: { x: {} } } } },
        "#/properties/a/patternProperties",
      ],
      [{ type: "object", properties: { a: { $ref: "other.json#/x" } } }, "#/properties/a/$ref"],
      [{ type: "object", properties: { a: { $ref: "#/$defs/missing" } } }, "#/properties/a/$ref"],
      [
        {
          type: "object",
          properties: { a: { allOf: [{ properties: { x: {} } }, { properties: { y: {} } }] } },
        },
        "#/properties/a/allOf",
      ],
    ];
    for (const [schema, at] of cases) {
      expect(() => toStrictSchema(schema as never, "custom_tool")).toThrow(TypeError);
      expect(() => toStrictSchema(schema as never, "custom_tool")).toThrow(
        new RegExp(`^custom_tool: strict mode cannot express .* at ${at.replaceAll("$", "\\$")}$`),
      );
    }
    const signature = {
      ...defaultReadSignature(),
      schema: { type: "object", properties: { path: { type: "string" } }, patternProperties: {} },
    };
    expect(() => createAiSdkReadTool({ fs: memoryFileSystem(), signature })).toThrow(
      "read: strict mode cannot express",
    );
  });

  test("fromStrictInput drops only the null of an optional property", () => {
    const schema = multiEditSignature().schema;
    const input = { path: "a", edits: [{ oldText: "x", newText: "y" }] };
    expect(fromStrictInput(schema, input)).toEqual(input);
    const read = defaultReadSignature().schema;
    expect(fromStrictInput(read, { path: "a", offset: null, limit: 3 })).toEqual({
      path: "a",
      limit: 3,
    });
    // A null for a required property is left for the signature to refuse.
    expect(fromStrictInput(read, { path: null })).toEqual({ path: null });
  });

  test("the validator and execute accept the nulls a strict model sends", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\ntwo\n" } });
    const read = createAiSdkReadTool({ fs });
    const validated = await read.inputSchema.validate?.({
      path: "/a.txt",
      offset: null,
      limit: null,
    });
    expect(validated).toEqual({ success: true, value: { path: "/a.txt" } });
    const result = await read.execute({ path: "/a.txt", offset: 2, limit: null }, executeOptions());
    expect(result.status).toBe("ok");
    expect(result.request?.offset).toBe(2);

    const edit = createAiSdkEditTool({ fs });
    expect(
      await edit.inputSchema.validate?.({
        path: "/a.txt",
        old_string: "one",
        new_string: "1",
        replace_all: null,
      }),
    ).toMatchObject({ success: true });

    const bash = createAiSdkBashTool({ runner, env: shellEnv() });
    const ran = await bash.execute({ command: "ls", timeout: null, cwd: null }, executeOptions());
    expect(ran.status).toBe("ok");
  });

  test("generateText runs a strict tool call with null optional parameters", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" } });
    const read = createAiSdkReadTool({ fs });
    const model = new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "read-1",
              toolName: "read",
              input: JSON.stringify({ path: "/a.txt", offset: null, limit: null }),
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
      prompt: "Read /a.txt",
      tools: { read },
      stopWhen: isStepCount(2),
    });

    const output = generated.steps[0]?.toolResults[0]?.output as ReadResult;
    expect(output.status).toBe("ok");
  });
});
