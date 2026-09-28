import { describe, expect, test } from "bun:test";

import { createReadTool, imageConverter } from "../../src/index.ts";
import type { ReadHookContext, ReadContext } from "../../src/index.ts";
import { corpus } from "../fixtures/corpus.ts";
import { expectMedia, expectUnsupported, harness } from "../helpers.ts";
import { memoryFileSystem } from "@better-fs-tools/fs";

interface Host {
  readonly id: string;
}

function fixture(name: string): Uint8Array {
  const bytes = corpus[name];
  if (bytes === undefined) throw new Error(`no corpus file ${name}`);
  return bytes;
}

describe("imageConverter", () => {
  test("turns each corpus image into one media part with the sniffed type", async () => {
    const images = {
      "/image.png": "image/png",
      "/image.jpg": "image/jpeg",
      "/image.gif": "image/gif",
      "/image.webp": "image/webp",
    } as const;
    const { read } = harness({
      files: Object.fromEntries(Object.keys(images).map((path) => [path, fixture(path.slice(1))])),
      deps: { converters: [imageConverter()] },
    });
    for (const [path, mediaType] of Object.entries(images)) {
      const result = expectMedia(await read({ path }));
      expect(result.parts).toEqual([
        { type: "media", mediaType, data: fixture(path.slice(1)), name: path.slice(1) },
      ]);
      expect(result.conversion).toEqual({ converter: "image", mimeType: mediaType });
      expect(result.content).toEqual(result.parts);
    }
  });

  test("declines anything that is not an IMAGE", async () => {
    const { read } = harness({
      files: { "/a.pdf": fixture("document.pdf"), "/a.txt": "text\n" },
      deps: { converters: [imageConverter()] },
    });
    expectUnsupported(await read({ path: "/a.pdf" }), "PDF");
    expect((await read({ path: "/a.txt" })).status).toBe("ok");
  });

  test("an image over maxMediaBytes gives TOO_LARGE", async () => {
    const { read } = harness({
      files: { "/a.png": fixture("image.png") },
      limits: { maxMediaBytes: 4 },
      deps: { converters: [imageConverter()] },
    });
    expectUnsupported(await read({ path: "/a.png" }), "TOO_LARGE");
  });

  test("transform gets the bytes, the type, and the same call object", async () => {
    const seen: ReadHookContext<Host>[] = [];
    const call: ReadContext<Host> = { host: { id: "h1" } };
    const read = createReadTool<Host>({
      fs: memoryFileSystem({ files: { "/a.png": fixture("image.png") } }),
      limits: { maxMediaBytes: 4 },
      converters: [
        imageConverter({
          async transform(bytes, mediaType, ctx) {
            seen.push(ctx);
            expect(mediaType).toBe("image/png");
            return bytes.subarray(0, ctx.call.host.id.length);
          },
        }),
      ],
    });
    const result = expectMedia(await read({ path: "/a.png" }, call));
    expect(seen[0]?.call).toBe(call);
    // The cap applies to the transformed bytes.
    expect(result.parts[0]).toMatchObject({
      data: fixture("image.png").subarray(0, 2),
    });
  });

  test("a transform that throws gives EXTENSION_FAILED", async () => {
    const { read } = harness({
      files: { "/a.png": fixture("image.png") },
      deps: {
        converters: [
          imageConverter({
            transform: async () => {
              throw new Error("resize failed");
            },
          }),
        ],
      },
    });
    const result = await read({ path: "/a.png" });
    expect(result.status === "error" && result.notes[0]?.data).toEqual({
      extension: "converters",
      phase: "conversion",
      id: "image",
    });
  });

  test("rejects a transform that is not a function", () => {
    expect(() => imageConverter({ transform: 1 as never })).toThrow(TypeError);
  });
});
