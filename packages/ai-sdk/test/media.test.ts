import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";

import type { ToolExecutionOptions } from "ai";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { directoryListing, imageConverter, textOf } from "@better-fs-tools/read";
import type { FileConverter, ReadHookContext, ReadResult } from "@better-fs-tools/read";

import { createAiSdkFsTools, createAiSdkReadTool, toAiSdkOutput } from "../src/index.ts";
import type { AiSdkToolOutput } from "../src/index.ts";
import { CLOCK, executeOptions, expectOk } from "./helpers.ts";

const PNG = new Uint8Array(
  await readFile(new URL("../../read/test/fixtures/files/pixel.png", import.meta.url)),
);

const IMAGE_OUTPUT: AiSdkToolOutput = {
  type: "content",
  value: [
    {
      type: "file",
      mediaType: "image/png",
      data: { type: "data", data: Buffer.from(PNG).toString("base64") },
    },
  ],
};

describe("AI SDK images by default", () => {
  test("createAiSdkReadTool() returns an image as a file part", async () => {
    const read = createAiSdkReadTool({ fs: memoryFileSystem({ files: { "/a.png": PNG } }) });
    const result = await read.execute({ path: "/a.png" }, executeOptions());
    expect(result.status).toBe("media");
    expect(read.toModelOutput({ output: result })).toEqual(IMAGE_OUTPUT);
  });

  test("converters: [] turns images off: the read refuses the image", async () => {
    const read = createAiSdkReadTool({
      fs: memoryFileSystem({ files: { "/a.png": PNG } }),
      converters: [],
    });
    const result = await read.execute({ path: "/a.png" }, executeOptions());
    expect(result.status).toBe("unsupported");
    expect(result.notes[0]?.code).toBe("unsupported-image");
  });

  test("a converter list without imageConverter() replaces the default", async () => {
    const read = createAiSdkReadTool({
      fs: memoryFileSystem({ files: { "/a.png": PNG } }),
      converters: [directoryListing()],
    });
    expect((await read.execute({ path: "/a.png" }, executeOptions())).status).toBe("unsupported");
  });

  test("createAiSdkFsTools() reads an image; read.converters: [] turns it off", async () => {
    const fs = memoryFileSystem({ files: { "/a.png": PNG } });
    const { read } = createAiSdkFsTools({ fs });
    const result = await read.execute({ path: "/a.png" }, executeOptions());
    expect(read.toModelOutput({ output: result })).toEqual(IMAGE_OUTPUT);

    const off = createAiSdkFsTools({ fs, read: { converters: [] } }).read;
    expect((await off.execute({ path: "/a.png" }, executeOptions())).status).toBe("unsupported");
  });
});

describe("AI SDK media parts", () => {
  test("an image read becomes one base64 file part", async () => {
    const read = createAiSdkReadTool({
      fs: memoryFileSystem({ files: { "/a.png": PNG } }),
      clock: CLOCK,
      converters: [imageConverter()],
    });
    const result = await read.execute({ path: "/a.png" }, executeOptions());
    expect(result.status).toBe("media");
    expect(read.toModelOutput({ output: result })).toEqual({
      type: "content",
      value: [
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "data", data: Buffer.from(PNG).toString("base64") },
        },
      ],
    });
  });

  test("toAiSdkOutput keeps text and media parts in order", () => {
    const data = Uint8Array.from({ length: 70_000 }, (_, index) => index % 251);
    const result: ReadResult = {
      tool: "read",
      status: "error",
      error: { code: "IO_ERROR", phase: "open", message: "" },
      request: null,
      file: null,
      notes: [],
      content: [
        { type: "text", text: "before" },
        { type: "media", mediaType: "application/pdf", data, name: "a.pdf" },
        { type: "text", text: "after" },
      ],
    };
    expect(toAiSdkOutput(result).value).toEqual([
      { type: "text", text: "before" },
      {
        type: "file",
        mediaType: "application/pdf",
        data: { type: "data", data: Buffer.from(data).toString("base64") },
      },
      { type: "text", text: "after" },
    ]);
  });

  test("a directory read lists entries as text", async () => {
    const read = createAiSdkReadTool({
      fs: memoryFileSystem({ files: { "/d/a.txt": "a", "/d/sub/b.txt": "b" } }),
      converters: [directoryListing({ trailingSlash: true })],
    });
    const result = expectOk(await read.execute({ path: "/d" }, executeOptions()));
    expect(textOf(result)).toBe("1|a.txt\n2|sub/");
  });

  test("the converter gets the ToolExecutionOptions object as host", async () => {
    const seen: ReadHookContext<ToolExecutionOptions<Record<string, unknown>>>[] = [];
    const converter: FileConverter<ToolExecutionOptions<Record<string, unknown>>> = {
      id: "host",
      target: "file",
      accepts: () => true,
      async convert(_input, ctx) {
        seen.push(ctx);
        return { kind: "text", text: ctx.call.host.toolCallId, mimeType: null };
      },
    };
    const read = createAiSdkReadTool<Record<string, unknown>>({
      fs: memoryFileSystem({ files: { "/a.png": PNG } }),
      converters: [converter],
    });
    const options = executeOptions();
    const result = expectOk(await read.execute({ path: "/a.png" }, options));
    expect(seen[0]?.call.host).toBe(options);
    expect(textOf(result)).toBe("1|read-call");
  });
});
