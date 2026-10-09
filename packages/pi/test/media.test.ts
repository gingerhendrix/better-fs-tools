import { describe, expect, test } from "bun:test";

import { mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { directoryListing, imageConverter } from "@better-fs-tools/read";
import type {
  DirectoryConverter,
  ReadAuthorizeTarget,
  ReadHookContext,
} from "@better-fs-tools/read";

import fsToolsExtension from "../src/extension.ts";
import { createPiFsTools, createPiReadTool } from "../src/index.ts";
import type { PiContentPart, PiMutationTool, PiReadTool } from "../src/index.ts";
import { execute, fixtures, piContext, textOf } from "./helpers.ts";

const fixture = fixtures();

const PNG = new Uint8Array(
  await readFile(new URL("../../read/test/fixtures/files/pixel.png", import.meta.url)),
);

const IMAGE_PART: PiContentPart = {
  type: "image",
  data: Buffer.from(PNG).toString("base64"),
  mimeType: "image/png",
};

describe("pi images by default", () => {
  test("createPiReadTool() returns an image as a Pi image part", async () => {
    const cwd = await fixture({ "a.png": PNG });
    const result = await execute(createPiReadTool(), { path: "a.png" }, cwd);
    expect(result.content).toEqual([IMAGE_PART]);
    expect(result.details).toEqual({});
  });

  test("converters: [] turns images off: the read refuses the image", async () => {
    const cwd = await fixture({ "a.png": PNG });
    const result = await execute(createPiReadTool({ converters: [] }), { path: "a.png" }, cwd);
    expect(textOf(result)).toStartWith("[read:unsupported-image]");
  });

  test("a converter list without imageConverter() replaces the default", async () => {
    const cwd = await fixture({ "a.png": PNG });
    const tool = createPiReadTool({ converters: [directoryListing()] });
    expect(textOf(await execute(tool, { path: "a.png" }, cwd))).toStartWith(
      "[read:unsupported-image]",
    );
  });

  test("createPiFsTools() reads an image; read.converters: [] turns it off", async () => {
    const cwd = await fixture({ "a.png": PNG });
    const on = await execute(createPiFsTools().read, { path: "a.png" }, cwd);
    expect(on.content).toEqual([IMAGE_PART]);
    const off = await execute(
      createPiFsTools({ read: { converters: [] } }).read,
      { path: "a.png" },
      cwd,
    );
    expect(textOf(off)).toStartWith("[read:unsupported-image]");
  });

  test("the extension's read returns an image", async () => {
    const registered: (PiReadTool | PiMutationTool)[] = [];
    fsToolsExtension({
      registerTool: (tool: PiReadTool | PiMutationTool) => registered.push(tool),
    });
    const read = registered[0] as PiReadTool;
    const cwd = await fixture({ "a.png": PNG });
    expect((await execute(read, { path: "a.png" }, cwd)).content).toEqual([IMAGE_PART]);
  });
});

describe("pi media parts", () => {
  test("an image read becomes one Pi image part with {} details", async () => {
    const cwd = await fixture({ "a.png": PNG });
    const tool = createPiReadTool({ converters: [imageConverter()] });
    const result = await execute(tool, { path: "a.png" }, cwd);
    expect(result.content).toEqual([
      { type: "image", data: Buffer.from(PNG).toString("base64"), mimeType: "image/png" },
    ]);
    expect(result.details).toEqual({});
  });

  test("media that is not an image becomes a text part that says so", async () => {
    const cwd = await fixture({ "a.pdf": "%PDF-1.7\n%binary\n" });
    const tool = createPiReadTool({
      converters: [
        {
          id: "pdf-pass-through",
          target: "file",
          accepts: (match) => match.classification.kind === "unsupported",
          async convert() {
            return {
              kind: "media",
              parts: [
                { type: "text", text: "caption" },
                { type: "media", mediaType: "application/pdf", data: Uint8Array.from([1, 2]) },
              ],
            };
          },
        },
      ],
    });
    const result = await execute(tool, { path: "a.pdf" }, cwd);
    expect(result.content).toEqual([
      { type: "text", text: "caption" },
      {
        type: "text",
        text: "[read:media-omitted] application/pdf (2 bytes) cannot be shown in Pi.",
      },
    ]);
  });
});

describe("pi directory reads", () => {
  test("a directory lists its entries, pages with offset and limit, and has details", async () => {
    const cwd = await fixture({ "d/a.txt": "a", "d/b.txt": "b", "d/c.txt": "c" });
    const tool = createPiReadTool({ converters: [directoryListing()] });
    const result = await execute(tool, { path: "d", limit: 2 }, cwd);
    expect(textOf(result)).toBe(
      '1|a.txt\n2|b.txt\n\n[read:continue] Output stopped at the line limit. Continue with {"path":"d","offset":3,"limit":2}.',
    );
    expect(result.details.truncation).toMatchObject({ truncatedBy: "lines", totalLines: 3 });
  });

  test("a symlinked directory is listed and authorized on its realpath", async () => {
    const cwd = await fixture({ "real/a.txt": "a" });
    await mkdir(path.join(cwd, "links"));
    await symlink(path.join(cwd, "real"), path.join(cwd, "links", "dir"));
    const targets: ReadAuthorizeTarget[] = [];
    const tool = createPiReadTool({
      authorize: {
        id: "log",
        authorize(target) {
          targets.push(target);
          return { allow: true };
        },
      },
      converters: [directoryListing()],
    });
    const result = await execute(tool, { path: "links/dir" }, cwd);
    expect(textOf(result)).toBe("1|a.txt");
    expect(targets).toEqual([
      {
        action: "list",
        requestedPath: "links/dir",
        resolvedPath: path.join(cwd, "real"),
        displayPath: "real",
        size: null,
        mtimeMs: null,
      },
    ]);
  });

  test("the directory converter gets ctx as host", async () => {
    const cwd = await fixture({ "d/a.txt": "a" });
    const seen: ReadHookContext<ExtensionContext>[] = [];
    const converter: DirectoryConverter<ExtensionContext> = {
      id: "host",
      target: "directory",
      async convert(_input, ctx) {
        seen.push(ctx);
        return { kind: "text", text: ctx.call.host.cwd, mimeType: null };
      },
    };
    const tool = createPiReadTool({ converters: [converter] });
    const ctx = piContext(cwd);
    const result = await tool.execute("call-1", { path: "d" }, undefined, undefined, ctx);
    expect(seen[0]?.call.host).toBe(ctx);
    expect(seen[0]?.call.callId).toBe("call-1");
    expect(textOf(result)).toBe(`1|${cwd}`);
  });
});
