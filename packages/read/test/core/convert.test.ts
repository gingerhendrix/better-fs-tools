import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { FileSystem, MemoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, textOf } from "../../src/index.ts";
import type {
  ConverterMatch,
  ConvertOutcome,
  FileConverter,
  FileConvertInput,
  HookContext,
  ReadContext,
  ReadToolDeps,
  StateNeedsDigest,
} from "../../src/index.ts";
import { createMemoryStore } from "../../src/state/index.ts";
import {
  FIXED_DATE,
  expectFailure,
  expectMedia,
  expectOk,
  expectUnsupported,
  lineText,
  note,
  testDigest,
} from "../helpers.ts";

interface Host {
  readonly id: string;
}

const ENCODER = new TextEncoder();
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A file converter for every file, or for the given classification code. */
function converter(
  convert: (input: FileConvertInput, ctx: HookContext<unknown>) => Promise<ConvertOutcome>,
  accepts: (match: ConverterMatch) => boolean = () => true,
  id = "test",
): FileConverter<unknown> {
  return { id, target: "file", accepts, convert };
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: number[] = [];
  for await (const chunk of source) chunks.push(...chunk);
  return Uint8Array.from(chunks);
}

function sourceHash(bytes: Uint8Array): string {
  const stream = testDigest().create();
  stream.update(bytes);
  return stream.digest();
}

/** Records bytes(), verify(), and close() on every opened file, in order. */
function spied(inner: MemoryFileSystem) {
  const log: string[] = [];
  const fs: FileSystem = {
    id: inner.id,
    capabilities: inner.capabilities,
    paths: inner.paths,
    async open(path, options) {
      const opened = await inner.open(path, options);
      if (!opened.ok) return opened;
      const file = opened.file;
      return {
        ok: true,
        file: {
          info: file.info,
          bytes() {
            log.push("bytes");
            return file.bytes();
          },
          async verify() {
            log.push("verify");
            return file.verify();
          },
          async close() {
            log.push("close");
            await file.close();
          },
        },
      };
    },
  };
  return { fs, log };
}

function tool(
  files: Record<string, string | Uint8Array>,
  deps: Omit<ReadToolDeps, "fs">,
  chunkBytes?: number,
) {
  const memory = memoryFileSystem({
    files,
    ...(chunkBytes === undefined ? {} : { chunkBytes }),
  });
  const read = createReadTool({
    fs: memory,
    digest: testDigest(),
    clock: () => FIXED_DATE,
    ...deps,
  } as ReadToolDeps & StateNeedsDigest);
  return { read, memory };
}

describe("converter selection", () => {
  test("the first converter that accepts runs, with the classifier's match", async () => {
    const matches: ConverterMatch[] = [];
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(
            async () => ({ kind: "text", text: "no", mimeType: null }),
            (match) => {
              matches.push(match);
              return false;
            },
            "declines",
          ),
          converter(
            async () => ({ kind: "text", text: "yes", mimeType: "text/plain" }),
            (match) => match.classification.kind === "unsupported",
            "accepts",
          ),
        ],
      },
    );
    const result = expectOk(await read({ path: "/a.png" }));
    expect(lineText(result)).toEqual(["yes"]);
    expect(result.conversion).toEqual({ converter: "accepts", mimeType: "text/plain" });
    expect(result.classification).toMatchObject({
      kind: "unsupported",
      classifier: "image",
      code: "IMAGE",
      mimeType: "image/png",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.classifier).toBe("image");
    expect(matches[0]?.sample.complete).toBe(true);
    expect(Object.isFrozen(matches[0])).toBe(true);
  });

  test("with no accepting converter the classifier's refusal stands", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(
            async () => ({ kind: "text", text: "x", mimeType: null }),
            () => false,
          ),
        ],
      },
    );
    expectUnsupported(await read({ path: "/a.png" }), "IMAGE");
  });

  test("a converter can take text files too, and its refusal gives unsupported", async () => {
    const refusal = { code: "no-csv", severity: "warning", message: "Not today." } as const;
    const { read } = tool(
      { "/a.csv": "a,b\n" },
      { converters: [converter(async () => ({ kind: "refuse", code: "CSV", note: refusal }))] },
    );
    const result = expectUnsupported(await read({ path: "/a.csv" }), "CSV");
    expect(result.notes).toEqual([refusal]);
    expect(result.classification.kind).toBe("text");
    expect(textOf(result)).toBe("[read:no-csv] Not today.");
  });
});

describe("the source stream", () => {
  test("starts at byte 0 with the sample, then the rest, and is single use", async () => {
    const bytes = ENCODER.encode("0123456789abcdefghij");
    const seen: Uint8Array[] = [];
    let second: unknown = null;
    const { read } = tool(
      { "/a.txt": bytes },
      {
        limits: { sampleBytes: 4 },
        converters: [
          converter(async (input) => {
            expect(input.sample.bytes).toEqual(bytes.subarray(0, 4));
            seen.push(await collect(input.bytes()));
            try {
              input.bytes();
            } catch (error) {
              second = error;
            }
            return { kind: "text", text: "done", mimeType: null };
          }),
        ],
      },
      3,
    );
    expectOk(await read({ path: "/a.txt" }));
    expect(seen).toEqual([bytes]);
    expect(second).toBeInstanceOf(TypeError);
  });

  test("input over maxConvertBytes gives TOO_LARGE", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      {
        limits: { maxConvertBytes: 8, sampleBytes: 8 },
        converters: [
          converter(async (input) => {
            await collect(input.bytes());
            return { kind: "text", text: "never", mimeType: null };
          }),
        ],
      },
    );
    const result = expectUnsupported(await read({ path: "/a.png" }), "TOO_LARGE");
    expect(result.classification.code).toBe("IMAGE");
    expect(result.notes).toEqual([
      {
        code: "too-large",
        severity: "warning",
        message: "/a.png is larger than the 8-byte conversion limit, so it was not converted.",
        data: { stage: "convert", limit: 8 },
      },
    ]);
  });

  test("TOO_LARGE also when the converter catches the error", async () => {
    let caught: unknown = null;
    const { read } = tool(
      { "/a.png": PNG },
      {
        limits: { maxConvertBytes: 8 },
        converters: [
          converter(async (input) => {
            try {
              await collect(input.bytes());
            } catch (error) {
              caught = error;
            }
            return { kind: "text", text: "partial", mimeType: null };
          }),
        ],
      },
    );
    expectUnsupported(await read({ path: "/a.png" }), "TOO_LARGE");
    expect(caught).toBeInstanceOf(Error);
  });

  test("TOO_LARGE also when the converter stops early and the rest is over the cap", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      {
        limits: { maxConvertBytes: 8, sampleBytes: 8 },
        converters: [
          converter(async () => ({ kind: "text", text: "header only", mimeType: null })),
        ],
      },
    );
    expectUnsupported(await read({ path: "/a.png" }), "TOO_LARGE");
  });

  test("contentId equals the hash of the source bytes, not the converted text", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(async (input) => {
            // Reads only the first chunk; the core reads the rest for the hash.
            for await (const _chunk of input.bytes()) break;
            return { kind: "text", text: "a picture", mimeType: "text/plain" };
          }),
        ],
      },
    );
    const result = expectOk(await read({ path: "/a.png" }));
    expect(result.observation?.contentId).toBe(sourceHash(PNG));
    expect(result.observation?.viewId).toBe(testDigest().hash("a picture"));
    expect(result.observation?.wholeFileVisible).toBe(true);
  });

  test("a backend failure in the source gives IO_ERROR, even when the converter catches it", async () => {
    const inner = memoryFileSystem({ files: { "/a.png": PNG } });
    const fs: FileSystem = {
      ...inner,
      async open(path, options) {
        const opened = await inner.open(path, options);
        if (!opened.ok) return opened;
        return {
          ok: true,
          file: {
            ...opened.file,
            async *bytes() {
              yield PNG.subarray(0, 8);
              throw new Error("disk gone");
            },
          },
        };
      },
    };
    const read = createReadTool({
      fs,
      limits: { sampleBytes: 8 },
      converters: [
        converter(async (input) => {
          try {
            await collect(input.bytes());
          } catch {
            // Swallowed on purpose.
          }
          return { kind: "text", text: "x", mimeType: null };
        }),
      ],
    });
    const result = expectFailure(await read({ path: "/a.png" }), "IO_ERROR");
    expect(note(result, "io-error")?.data).toEqual({ detail: "disk gone" });
  });
});

describe("converted text", () => {
  const long = `${"x".repeat(30)}\nb\nc\nd\n`;
  const text = converter(async () => ({ kind: "text", text: long, mimeType: "text/plain" }));

  test("gets clamping, a line limit, and a continuation", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      { limits: { maxCharsPerLine: 10 }, converters: [text] },
    );
    const result = expectOk(await read({ path: "/a.png", limit: 2 }));
    expect(lineText(result)).toEqual(["x".repeat(10), "b"]);
    expect(result.view.lines[0]).toMatchObject({ clamped: true, sourceChars: 30 });
    expect(result.truncation.reasons).toEqual(["lines", "line-length"]);
    expect(result.continuation.next).toEqual({ path: "/a.png", offset: 3, limit: 2 });
    expect(note(result, "continue")?.retry).toEqual({ path: "/a.png", offset: 3, limit: 2 });
    expect(note(result, "line-clamped")).toBeDefined();
    expect(result.totals).toEqual({
      lines: 4,
      exact: true,
      bytes: ENCODER.encode(long).byteLength,
    });
    expect(result.observation?.wholeFileVisible).toBe(false);
    expect(result.observation?.contentId).toBe(sourceHash(PNG));
  });

  test("offset pages through the converted lines", async () => {
    const { read } = tool({ "/a.png": PNG }, { converters: [text] });
    const result = expectOk(await read({ path: "/a.png", offset: 3, limit: 1 }));
    expect(lineText(result)).toEqual(["c"]);
    expect(result.view.startLine).toBe(3);
    expect(result.continuation.next).toEqual({ path: "/a.png", offset: 4, limit: 1 });
  });

  test("streamed text is scanned as it arrives, and the scan cap applies", async () => {
    const pulled: number[] = [];
    const { read } = tool(
      { "/a.png": PNG },
      {
        limits: { maxScanBytes: 16, sampleBytes: 8 },
        converters: [
          converter(async () => ({
            kind: "text",
            mimeType: null,
            text: (async function* () {
              for (let index = 1; index <= 10; index += 1) {
                pulled.push(index);
                yield `line ${index}\n`;
              }
            })(),
          })),
        ],
      },
    );
    const result = expectOk(await read({ path: "/a.png" }));
    expect(lineText(result)).toEqual(["line 1", "line 2"]);
    expect(result.truncation.reasons).toContain("scan-limit");
    expect(result.totals.exact).toBe(false);
    expect(pulled.length).toBeLessThan(10);
    expect(note(result, "scan-limit")).toBeDefined();
  });

  test("converter notes follow the view notes", async () => {
    const extra = { code: "converted", severity: "info", message: "Converted." } as const;
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(async () => ({ kind: "text", text: "a\nb\n", mimeType: null, notes: [extra] })),
        ],
      },
    );
    const result = expectOk(await read({ path: "/a.png", limit: 1 }));
    expect(result.notes.map((entry) => entry.code)).toEqual(["continue", "converted"]);
  });
});

describe("verification after conversion", () => {
  test("verify() runs after the conversion, and a change gives CHANGED_DURING_READ", async () => {
    const memory = memoryFileSystem({ files: { "/a.png": PNG } });
    const { fs, log } = spied(memory);
    let edit = false;
    const read = createReadTool({
      fs,
      converters: [
        converter(async (input) => {
          await collect(input.bytes());
          log.push("converted");
          if (edit) memory.setFile("/a.png", PNG.subarray(0, 9));
          return { kind: "text", text: "x", mimeType: null };
        }),
      ],
    });
    expectOk(await read({ path: "/a.png" }));
    expect(log).toEqual(["bytes", "converted", "verify", "close"]);

    edit = true;
    log.length = 0;
    const changed = expectFailure(await read({ path: "/a.png" }), "CHANGED_DURING_READ");
    expect(log).toEqual(["bytes", "converted", "verify", "close"]);
    expect(changed.notes[0]?.retry).toEqual({ path: "/a.png", offset: 1, limit: 2_000 });
  });

  test("the size check runs after the conversion", async () => {
    const inner = memoryFileSystem({ files: { "/a.png": PNG } });
    const fs: FileSystem = {
      ...inner,
      async open(path, options) {
        const opened = await inner.open(path, options);
        if (!opened.ok) return opened;
        // The backend reports one more byte than it streams.
        return { ok: true, file: { ...opened.file, info: { ...opened.file.info, size: 12 } } };
      },
    };
    let converted = false;
    const read = createReadTool({
      fs,
      limits: { sampleBytes: 8 },
      converters: [
        converter(async () => {
          converted = true;
          return { kind: "text", text: "x", mimeType: null };
        }),
      ],
    });
    expectFailure(await read({ path: "/a.png" }), "CHANGED_DURING_READ");
    expect(converted).toBe(true);
  });
});

describe("media outcomes", () => {
  const media = (data: Uint8Array) =>
    converter(async (input) => {
      await collect(input.bytes());
      return {
        kind: "media",
        parts: [
          { type: "text", text: "caption" },
          { type: "media", mediaType: "image/png", data, name: "a.png" },
        ],
      };
    });

  test("a media outcome carries the parts, the conversion, and an observation", async () => {
    const { read } = tool({ "/a.png": PNG }, { converters: [media(PNG)] });
    const result = expectMedia(await read({ path: "/a.png" }));
    expect(result.conversion).toEqual({ converter: "test", mimeType: "image/png" });
    expect(result.parts).toHaveLength(2);
    expect(result.observation?.contentId).toBe(sourceHash(PNG));
    expect(result.observation?.wholeFileVisible).toBe(false);
    expect(result.content).toEqual([
      { type: "text", text: "caption" },
      { type: "media", mediaType: "image/png", data: PNG, name: "a.png" },
    ]);
  });

  test("media over maxMediaBytes gives TOO_LARGE", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      { limits: { maxMediaBytes: 10 }, converters: [media(PNG)] },
    );
    const result = expectUnsupported(await read({ path: "/a.png" }), "TOO_LARGE");
    expect(result.notes[0]).toEqual({
      code: "too-large",
      severity: "warning",
      message:
        "The media converted from /a.png is larger than the 10-byte media limit, so it was not returned.",
      data: { stage: "media", limit: 10 },
    });
    expect(result.content).toEqual([
      { type: "text", text: `[read:too-large] ${result.notes[0]?.message}` },
    ]);
  });

  test("media at exactly maxMediaBytes passes; text parts do not count", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      { limits: { maxMediaBytes: PNG.byteLength }, converters: [media(PNG)] },
    );
    expectMedia(await read({ path: "/a.png" }));
  });

  test("a media outcome is recorded in the store", async () => {
    const store = createMemoryStore();
    const { read } = tool({ "/a.png": PNG }, { converters: [media(PNG)], state: store });
    const result = expectMedia(await read({ path: "/a.png" }));
    expect(await store.get("/a.png")).toMatchObject({
      observationId: result.observation?.id,
      contentId: sourceHash(PNG),
      wholeFileVisible: false,
      totalsExact: true,
    });
  });
});

describe("host code failures", () => {
  test("a throwing converter gives EXTENSION_FAILED with the extension and id", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(
            async () => {
              throw new Error("boom");
            },
            undefined,
            "pdf",
          ),
        ],
      },
    );
    const result = expectFailure(await read({ path: "/a.png" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({
      extension: "converters",
      phase: "conversion",
      id: "pdf",
    });
  });

  test("a throwing accepts gives EXTENSION_FAILED", async () => {
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(
            async () => ({ kind: "text", text: "x", mimeType: null }),
            () => {
              throw new Error("boom");
            },
            "picky",
          ),
        ],
      },
    );
    const result = expectFailure(await read({ path: "/a.png" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({
      extension: "converters",
      phase: "conversion",
      id: "picky",
    });
  });

  test("a malformed outcome or a bad text chunk gives EXTENSION_FAILED", async () => {
    const outcomes: unknown[] = [
      null,
      { kind: "text", text: 1, mimeType: null },
      { kind: "text", text: "x" },
      { kind: "media", parts: [{ type: "media", mediaType: "image/png", data: [1] }] },
      { kind: "refuse", code: "", note: { code: "x", severity: "info", message: "x" } },
      { kind: "refuse", code: "X" },
      { kind: "text", text: "x", mimeType: null, notes: [{}] },
      {
        kind: "text",
        mimeType: null,
        text: (async function* () {
          yield 1;
        })(),
      },
      {
        kind: "text",
        mimeType: null,
        text: (async function* () {
          yield "a\n";
          throw new Error("late");
        })(),
      },
    ];
    for (const produced of outcomes) {
      const { read } = tool(
        { "/a.png": PNG },
        { converters: [converter(async () => produced as ConvertOutcome)] },
      );
      const result = expectFailure(await read({ path: "/a.png" }), "EXTENSION_FAILED");
      expect(result.notes[0]?.data).toMatchObject({ extension: "converters", id: "test" });
    }
  });

  test("the handle closes after a throwing converter", async () => {
    const { fs, log } = spied(memoryFileSystem({ files: { "/a.png": PNG } }));
    const read = createReadTool({
      fs,
      converters: [
        converter(async () => {
          throw new Error("boom");
        }),
      ],
    });
    expectFailure(await read({ path: "/a.png" }), "EXTENSION_FAILED");
    expect(log).toEqual(["bytes", "close"]);
  });
});

describe("abort", () => {
  test("an abort while the converter waits gives ABORTED in the conversion phase", async () => {
    const controller = new AbortController();
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(async () => {
            controller.abort();
            return new Promise<ConvertOutcome>(() => {});
          }),
        ],
      },
    );
    const result = expectFailure(
      await read({ path: "/a.png" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "conversion" });
  });

  test("the signal is checked on each yielded chunk of converted text", async () => {
    const controller = new AbortController();
    let yielded = 0;
    const { read } = tool(
      { "/a.png": PNG },
      {
        converters: [
          converter(async () => ({
            kind: "text",
            mimeType: null,
            text: (async function* () {
              for (;;) {
                yielded += 1;
                if (yielded === 3) controller.abort();
                yield "line\n";
              }
            })(),
          })),
        ],
      },
    );
    const result = expectFailure(
      await read({ path: "/a.png" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "conversion" });
    expect(yielded).toBeLessThan(5);
  });
});

describe("the call object", () => {
  test("the converter gets the same call object the caller passed", async () => {
    const memory = memoryFileSystem({ files: { "/a.png": PNG } });
    const call: ReadContext<Host> = { host: { id: "h1" }, callId: "c1" };
    const seen: HookContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: memory,
      converters: [
        {
          id: "host",
          target: "file",
          accepts: () => true,
          async convert(_input, ctx) {
            seen.push(ctx);
            return { kind: "text", text: ctx.call.host.id, mimeType: null };
          },
        },
      ],
    });
    const result = expectOk(await read({ path: "/a.png" }, call));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.call).toBe(call);
    expect(seen[0]?.request).toEqual(result.request);
    expect(lineText(result)).toEqual(["h1"]);
  });
});
