import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, textConverter } from "../../src/index.ts";
import type { ConverterMatch, HookContext, ReadContext } from "../../src/index.ts";
import { corpus } from "../fixtures/corpus.ts";
import { expectOk, expectUnsupported, harness, lineText } from "../helpers.ts";

interface Host {
  readonly id: string;
}

const DECODER = new TextDecoder();

/** A stand-in for a pdftotext process: upper-cases the source text, line by line. */
async function* upper(source: AsyncIterable<Uint8Array>): AsyncIterable<string> {
  for await (const chunk of source) yield DECODER.decode(chunk, { stream: true }).toUpperCase();
}

const isPdf = (match: ConverterMatch) =>
  match.classification.kind === "unsupported" && match.classification.code === "PDF";

describe("textConverter", () => {
  test("runs the stream function and scans its text", async () => {
    const { read } = harness({
      files: { "/a.pdf": corpus["document.pdf"] ?? "" },
      deps: {
        converters: [
          textConverter({ id: "pdf", accepts: isPdf, mimeType: "text/plain", run: upper }),
        ],
      },
    });
    const result = expectOk(await read({ path: "/a.pdf" }));
    expect(lineText(result)).toEqual(["%PDF-1.7", "%BINARY"]);
    expect(result.conversion).toEqual({ converter: "pdf", mimeType: "text/plain" });
  });

  test("accepts decides; a declined file keeps its refusal", async () => {
    const { read } = harness({
      files: { "/a.pdf": corpus["document.pdf"] ?? "" },
      deps: {
        converters: [
          textConverter({ id: "pdf", accepts: () => false, mimeType: null, run: upper }),
        ],
      },
    });
    expectUnsupported(await read({ path: "/a.pdf" }), "PDF");
  });

  test("the source is capped: a run over maxConvertBytes gives TOO_LARGE", async () => {
    const { read } = harness({
      files: { "/a.pdf": corpus["document.pdf"] ?? "" },
      limits: { maxConvertBytes: 10, sampleBytes: 8 },
      deps: {
        converters: [textConverter({ id: "pdf", accepts: isPdf, mimeType: null, run: upper })],
      },
    });
    expectUnsupported(await read({ path: "/a.pdf" }), "TOO_LARGE");
  });

  test("run gets the same call object the caller passed", async () => {
    const seen: HookContext<Host>[] = [];
    const call: ReadContext<Host> = { host: { id: "h1" } };
    const read = createReadTool<Host>({
      fs: memoryFileSystem({ files: { "/a.pdf": corpus["document.pdf"] ?? "" } }),
      converters: [
        textConverter({
          id: "pdf",
          accepts: isPdf,
          mimeType: null,
          async *run(_source, ctx) {
            seen.push(ctx);
            yield ctx.call.host.id;
          },
        }),
      ],
    });
    expect(lineText(expectOk(await read({ path: "/a.pdf" }, call)))).toEqual(["h1"]);
    expect(seen[0]?.call).toBe(call);
  });

  test("rejects malformed options", () => {
    const run = upper;
    const accepts = () => true;
    expect(() => textConverter(null as never)).toThrow(TypeError);
    expect(() => textConverter({ id: "", accepts, mimeType: null, run })).toThrow(TypeError);
    expect(() => textConverter({ id: "x", accepts: 1 as never, mimeType: null, run })).toThrow(
      TypeError,
    );
    expect(() => textConverter({ id: "x", accepts, mimeType: null, run: 1 as never })).toThrow(
      TypeError,
    );
    expect(() => textConverter({ id: "x", accepts, mimeType: 1 as never, run })).toThrow(TypeError);
  });
});
