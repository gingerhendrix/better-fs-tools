import { describe, expect, test } from "bun:test";

import { mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { directoryListing, imageConverter } from "@better-fs-tools/read";
import type { AuthorizeTarget, DirectoryConverter, HookContext } from "@better-fs-tools/read";

import { createPiReadTool } from "../src/index.ts";
import { execute, fixture, piContext, textOf } from "./helpers.ts";

/** A real 1x1 PNG from the shared fixtures in the read package. */
const PNG = new Uint8Array(
  await readFile(new URL("../../read/test/fixtures/files/pixel.png", import.meta.url)),
);

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
    const targets: AuthorizeTarget[] = [];
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
    const seen: HookContext<ExtensionContext>[] = [];
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
