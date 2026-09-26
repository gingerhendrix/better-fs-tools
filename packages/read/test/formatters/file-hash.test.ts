import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  createReadTool,
  fileHashHeader,
  imageConverter,
  lineNumberFormatter,
  textOf,
} from "../../src/index.ts";
import { corpus } from "../fixtures/corpus.ts";
import { expectOk, harness } from "../helpers.ts";

const formatter = lineNumberFormatter({ header: fileHashHeader() });

describe("fileHashHeader", () => {
  test("prints observation.contentId before the body", async () => {
    const { read } = harness({ files: { "/a.txt": "one\n" }, deps: { formatter } });
    const result = expectOk(await read({ path: "/a.txt" }));
    const contentId = result.observation?.contentId;
    expect(contentId).toStartWith("fnv:");
    expect(textOf(result)).toBe(`file-hash: ${contentId}\n1|one`);
  });

  test("is the same for a partial view and changes after an edit", async () => {
    const { read, fs } = harness({ files: { "/a.txt": "one\ntwo\n" }, deps: { formatter } });
    const whole = textOf(await read({ path: "/a.txt" })).split("\n")[0];
    const partial = textOf(await read({ path: "/a.txt", offset: 2 })).split("\n")[0];
    expect(partial).toBe(whole);
    fs.write("/a.txt", "one\nTWO\n");
    expect(textOf(await read({ path: "/a.txt" })).split("\n")[0]).not.toBe(whole);
  });

  test("is absent when the scan is capped", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\nthree\nfour\n" },
      limits: { maxScanBytes: 8, sampleBytes: 8 },
      deps: { formatter },
    });
    const result = expectOk(await read({ path: "/a.txt", limit: 1 }));
    expect(result.observation?.contentId).toBeNull();
    expect(result.notes.map((entry) => entry.code)).toContain("scan-limit");
    expect(textOf(result)).not.toContain("file-hash");
    expect(textOf(result).split("\n")[0]).toBe("1|one");
  });

  test("is absent with no digest", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/a.txt": "one\n" } }),
      formatter,
    });
    expect(textOf(await read({ path: "/a.txt" }))).toBe("1|one");
  });

  test("is absent for a failure and shown for media", async () => {
    const { read } = harness({
      files: { "/a.png": corpus["image.png"] ?? new Uint8Array() },
      deps: { formatter, converters: [imageConverter()] },
    });
    const missing = await read({ path: "/missing.txt" });
    expect(textOf(missing)).not.toContain("file-hash");

    const media = await read({ path: "/a.png" });
    expect(media.status).toBe("media");
    expect(textOf(media)).toStartWith("file-hash: fnv:");
  });
});
