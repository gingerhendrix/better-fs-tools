import { describe, expect, test } from "bun:test";

import { generateText, isStepCount } from "ai";
import type { JSONSchema7, ToolExecutionOptions } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { lineNumberFormatter, textOf } from "@better-fs-tools/read";
import type { Formatter, ReadContext, ReadResult } from "@better-fs-tools/read";
import { defaultSignature, lineRangeSignature } from "@better-fs-tools/read/signature";

import { createAiSdkReadTool } from "../src/index.ts";
import type { AiSdkReadTool } from "../src/index.ts";
import { CLOCK, executeOptions, expectFailure, expectOk, stallingFileSystem } from "./helpers.ts";

function tool(files: Record<string, string | Uint8Array> = {}) {
  const fs = memoryFileSystem({ files });
  return { fs, read: createAiSdkReadTool({ fs, clock: CLOCK }) };
}

async function schemaOf(read: AiSdkReadTool): Promise<JSONSchema7> {
  return await read.inputSchema.jsonSchema;
}

async function validate(read: AiSdkReadTool, value: unknown) {
  const validator = read.inputSchema.validate;
  if (validator === undefined) throw new Error("the schema has no validator");
  return await validator(value);
}

describe("ai sdk input schema", () => {
  test("is the signature's schema, name, and description", async () => {
    const { read } = tool();
    const signature = defaultSignature();

    expect(read.strict).toBe(true);
    expect(read.name).toBe("read");
    expect(read.description).toBe(signature.description);
    expect(await schemaOf(read)).toEqual(signature.schema as JSONSchema7);
    expect(read.description).toMatch(/one-based/u);
    expect(read.description).toMatch(/continuation/u);
  });

  test("the validator accepts canonical input and returns it unchanged", async () => {
    const { read } = tool();
    const input = { path: "a.txt", offset: 2, limit: 3 };

    expect(await validate(read, input)).toEqual({ success: true, value: input });
    expect(await validate(read, { path: "a.txt" })).toEqual({
      success: true,
      value: { path: "a.txt" },
    });
  });

  test("the validator refuses aliases, string integers, zero, and unknown keys", async () => {
    const { read } = tool();
    const rejected: unknown[] = [
      { file_path: "a.txt" },
      { filePath: "a.txt" },
      { path: "a.txt", line: 2 },
      { path: "a.txt", offset: "2" },
      { path: "a.txt", limit: "3" },
      { path: "a.txt", offset: 0 },
      { path: "a.txt", limit: 0 },
      { path: "a.txt", offset: -1 },
      { path: "a.txt", offset: 1.5 },
      { path: "a.txt", extra: true },
      { path: "" },
      { path: "  " },
      { path: "a\0.txt" },
      { path: 7 },
      {},
      "a.txt",
      null,
      ["a.txt"],
    ];

    for (const value of rejected) {
      const result = await validate(read, value);
      if (result.success) throw new Error(`expected a rejection of ${JSON.stringify(value)}`);
      expect(result.error).toBeInstanceOf(TypeError);
    }
  });

  test("the validator names host parameters for a renamed signature", async () => {
    const fs = memoryFileSystem();
    const read = createAiSdkReadTool({
      fs,
      signature: lineRangeSignature({ names: { start: "start_line", end: "end_line" } }),
    });
    const result = await validate(read, { path: "a.txt", start_line: 5, end_line: 2 });
    if (result.success) throw new Error("expected a rejection");
    expect(result.error.message).toBe("end_line (2) must not be less than start_line (5)");
  });
});

describe("ai sdk execute", () => {
  test("returns the structured result for a successful read", async () => {
    const { read } = tool({ "/lines.txt": "one\ntwo\nthree\n" });
    const result = expectOk(await read.execute({ path: "/lines.txt", limit: 2 }, executeOptions()));

    expect(result.view.lines.map((line) => line.text)).toEqual(["one", "two"]);
    expect(result.truncation).toEqual({ truncated: true, reasons: ["lines"], primary: "lines" });
    expect(result.continuation.next).toEqual({ path: "/lines.txt", offset: 3, limit: 2 });
    expect(result.file.backend).toBe("memory");
  });

  test("returns an empty view for an empty file", async () => {
    const { read } = tool({ "/empty.txt": "" });
    const result = expectOk(await read.execute({ path: "/empty.txt" }, executeOptions()));

    expect(result.view.lines).toEqual([]);
    expect(result.totals.bytes).toBe(0);
    expect(result.notes.some((entry) => entry.code === "empty")).toBe(true);
  });

  test("returns an unsupported result for binary content", async () => {
    const { read } = tool({ "/blob.bin": new Uint8Array([0, 1, 2, 3, 0, 255]) });
    const result = await read.execute({ path: "/blob.bin" }, executeOptions());

    expect(result.status).toBe("unsupported");
    expect(result.notes.length).toBeGreaterThan(0);
  });

  test("returns a missing file as an error result", async () => {
    const { read } = tool({ "/a.txt": "alpha\n" });
    expectFailure(await read.execute({ path: "/missing.txt" }, executeOptions()), "NOT_FOUND");
  });

  test("a missing file carries nearby names in data and in the model text", async () => {
    const { read } = tool({ "/src/config.json": "{}\n" });
    const result = expectFailure(
      await read.execute({ path: "/src/config.jsan" }, executeOptions()),
      "NOT_FOUND",
    );
    expect(result.notes[0]?.data?.suggestions).toEqual(["config.json"]);
    expect(textOf(result)).toBe(
      '[read:not-found] /src/config.jsan was not found. Nearby names: "config.json".',
    );
  });

  test("rejects with TypeError for input the validator refuses", async () => {
    const { read } = tool({ "/a.txt": "alpha\n" });
    await expect(read.execute({ file_path: "/a.txt" }, executeOptions())).rejects.toThrow(
      "Unknown read input key: file_path. Expected path, offset, limit",
    );
  });

  test("forwards the host abort signal into a pending scan", async () => {
    // The first chunk covers the sample, so the stall and the abort land in
    // the scan itself rather than before any filesystem work.
    const { fs, stalled, release } = stallingFileSystem("/big.txt", "alpha\n".repeat(4_000));
    const read = createAiSdkReadTool({ fs, clock: CLOCK });
    const controller = new AbortController();

    const pending = read.execute({ path: "/big.txt" }, executeOptions(controller.signal));
    await stalled;
    controller.abort();
    // Let the stalled generator unwind so `close()` can return.
    release();

    const result = expectFailure(await pending, "ABORTED");
    expect(result.notes.find((entry) => entry.code === "aborted")?.data).toEqual({
      phase: "scan",
    });
  });

  test("passes the same ToolExecutionOptions object as host, with callId and signal", async () => {
    const seen: ReadContext<ToolExecutionOptions<{ user: string }>>[] = [];
    const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" } });
    const read = createAiSdkReadTool<{ user: string }>({
      fs: (call) => {
        seen.push(call);
        return fs;
      },
    });
    const controller = new AbortController();
    const options: ToolExecutionOptions<{ user: string }> = {
      toolCallId: "call-7",
      messages: [],
      context: { user: "ada" },
      abortSignal: controller.signal,
    };

    expectOk(await read.execute({ path: "/a.txt" }, options));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.host).toBe(options);
    expect(seen[0]?.callId).toBe("call-7");
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  test("the formatter gets the same call object as the fs factory", async () => {
    const calls: unknown[] = [];
    const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" } });
    const base = lineNumberFormatter();
    const formatter: Formatter<ToolExecutionOptions<Record<string, unknown>>> = {
      id: "spy",
      format(outcome, ctx) {
        calls.push(ctx.call);
        return base.format(outcome, ctx);
      },
    };
    const read = createAiSdkReadTool<Record<string, unknown>>({
      fs: (call) => {
        calls.push(call);
        return fs;
      },
      formatter,
    });
    const options = executeOptions();

    await read.execute({ path: "/a.txt" }, options);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect((calls[0] as ReadContext<unknown>).host).toBe(options);
  });

  test("the resolver and suggest get the same call object, with options as host", async () => {
    const calls: ReadContext<ToolExecutionOptions<Record<string, unknown>>>[] = [];
    const read = createAiSdkReadTool<Record<string, unknown>>({
      fs: memoryFileSystem({ files: { "/a.txt": "alpha\n" } }),
      resolve: {
        id: "spy",
        resolve(path, ctx) {
          calls.push(ctx.call);
          return { kind: "path", path };
        },
      },
      suggest: (ctx) => {
        calls.push(ctx.call);
        return [];
      },
    });
    const options = executeOptions();

    expectFailure(await read.execute({ path: "/b.txt" }, options), "NOT_FOUND");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    expect(calls[0]?.host).toBe(options);
  });

  test("omits the signal when the host supplies none", async () => {
    const seen: ReadContext<ToolExecutionOptions<Record<string, unknown>>>[] = [];
    const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" } });
    const read = createAiSdkReadTool<Record<string, unknown>>({
      fs: (call) => {
        seen.push(call);
        return fs;
      },
    });

    await read.execute({ path: "/a.txt" }, executeOptions());
    expect(Object.hasOwn(seen[0] as object, "signal")).toBe(false);
  });
});

describe("ai sdk messages", () => {
  test("continuation text uses host names; continuation.next stays canonical", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\ntwo\nthree\nfour\n" } });
    const read = createAiSdkReadTool({
      fs,
      signature: lineRangeSignature({
        names: { path: "file_path", start: "start_line", end: "end_line" },
      }),
    });
    const result = expectOk(
      await read.execute({ file_path: "/a.txt", start_line: 1, end_line: 2 }, executeOptions()),
    );

    expect(result.continuation.next).toEqual({ path: "/a.txt", offset: 3, limit: 2 });
    expect(textOf(result)).toContain(
      'Continue with {"file_path":"/a.txt","start_line":3,"end_line":4}.',
    );
    expect(textOf(result)).not.toContain('"offset"');
  });

  test("host messages override the signature's retry text", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one\ntwo\n" } });
    const read = createAiSdkReadTool({
      fs,
      messages: { retry: (next) => `read(${next.path}, ${next.offset})` },
    });
    const result = await read.execute({ path: "/a.txt", limit: 1 }, executeOptions());
    expect(textOf(result)).toContain("Continue with read(/a.txt, 2).");
  });

  test("unknown dependencies still throw from the core", () => {
    expect(() => createAiSdkReadTool({ fs: memoryFileSystem(), input: {} } as never)).toThrow(
      "Unknown read tool dependency: input",
    );
    expect(() => createAiSdkReadTool(null as never)).toThrow(TypeError);
  });
});

describe("ai sdk model output", () => {
  test("mirrors result.content for every status", async () => {
    const { read } = tool({
      "/ok.txt": "alpha\nbeta\n",
      "/empty.txt": "",
      "/blob.bin": new Uint8Array([0, 1, 2, 3, 0, 255]),
    });
    const results: ReadResult[] = [
      await read.execute({ path: "/ok.txt", limit: 1 }, executeOptions()),
      await read.execute({ path: "/empty.txt" }, executeOptions()),
      await read.execute({ path: "/blob.bin" }, executeOptions()),
      await read.execute({ path: "/missing.txt" }, executeOptions()),
    ];

    expect(results.map((result) => result.status)).toEqual(["ok", "ok", "unsupported", "error"]);
    for (const output of results) {
      expect(textOf(output).length).toBeGreaterThan(0);
      expect(read.toModelOutput({ output })).toEqual({
        type: "content",
        value: [{ type: "text", text: textOf(output) }],
      });
    }
  });
});

describe("ai sdk composition", () => {
  test("provider-free generateText drives the tool with the AI SDK mock model", async () => {
    const { read } = tool({ "/mock.txt": "from the mock model\n" });
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
              toolCallId: "read-1",
              toolName: "read",
              input: JSON.stringify({ path: "/mock.txt" }),
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
      prompt: "Read /mock.txt",
      tools: { [read.name]: read },
      stopWhen: isStepCount(2),
    });

    expect(generated.text).toBe("done");
    expect(generated.steps).toHaveLength(2);
    const output = generated.steps[0]?.toolResults[0]?.output as ReadResult;
    expect(expectOk(output).view.lines.map((line) => line.text)).toEqual(["from the mock model"]);
  });

  test("generateText reports a validator refusal with host names", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" } });
    const read = createAiSdkReadTool({
      fs,
      signature: lineRangeSignature({ names: { start: "start_line", end: "end_line" } }),
    });
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
              toolCallId: "read-1",
              toolName: "read",
              input: JSON.stringify({ path: "/a.txt", start_line: 3, end_line: 1 }),
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
    const parts = generated.steps[0]?.content ?? [];
    const error = parts.find((part) => part.type === "tool-error");
    expect(String((error as { error?: unknown } | undefined)?.error)).toContain(
      "end_line (1) must not be less than start_line (3)",
    );
  });
});
