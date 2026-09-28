import { describe, expect, test } from "bun:test";

import {
  deepAgentsFormat,
  hashlineFormat,
  hermesFormat,
  opencodeFormat,
} from "../../src/formats/index.ts";
import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  createReadTool,
  defaultLimits,
  directoryListing,
  eofFooter,
  fileHashHeader,
  hashlineGutter,
  imageConverter,
  lineNumberFormatter,
  redact,
} from "../../src/index.ts";
import type { ContentPart, FormatContext, Formatter, ReadContext } from "../../src/index.ts";
import { corpus } from "../fixtures/corpus.ts";
import { harness, testDigest } from "../helpers.ts";

const PRESETS: Record<string, () => Formatter<unknown>> = {
  opencode: opencodeFormat,
  deepAgents: deepAgentsFormat,
  hashline: hashlineFormat,
  hermes: hermesFormat,
};

const FILES = {
  "/src/app.ts": 'import { x } from "./x"\nexport const y = x\n',
  "/src/lib.ts": "export const x = 1\n",
  "/long.txt": "one\ntwo\nthree\nfour\nfive\n",
  "/wide.txt": `short\n${"w".repeat(40)}\n`,
  "/empty.txt": "",
  "/secret.txt": "key=AKIAABCDEFGHIJKLMNOP\n",
  "/blob.bin": Uint8Array.from([0x00, 0x01, 0x02, 0x00, 0xff]),
  "/image.png": corpus["image.png"] ?? new Uint8Array(),
};

/** One case for each outcome shape the presets must handle. */
const CASES = {
  ok: { path: "/src/app.ts" },
  truncated: { path: "/long.txt", offset: 2, limit: 2 },
  clamped: { path: "/wide.txt" },
  empty: { path: "/empty.txt" },
  "hook-edited": { path: "/secret.txt" },
  "not-found": { path: "/src/ap.ts" },
  unsupported: { path: "/blob.bin" },
  media: { path: "/image.png" },
  directory: { path: "/src" },
} as const;

function tool(formatter: Formatter<unknown>) {
  return harness({
    files: FILES,
    limits: { maxCharsPerLine: 30 },
    deps: {
      formatter,
      converters: [imageConverter(), directoryListing()],
      hooks: [redact({ patterns: [/AKIA[0-9A-Z]{16}/gu] })],
    },
  }).read;
}

/** Text parts as they are, media parts as one line with their type and size. */
function render(content: readonly ContentPart[]): string {
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : `[media ${part.mediaType} ${part.data.byteLength} bytes${part.name ? ` ${part.name}` : ""}]`,
    )
    .join("\n--- part ---\n");
}

describe("format presets", () => {
  for (const [name, make] of Object.entries(PRESETS)) {
    describe(name, () => {
      for (const [label, input] of Object.entries(CASES)) {
        test(label, async () => {
          const result = await tool(make())(input);
          expect(`${result.status}\n${render(result.content)}`).toMatchSnapshot();
        });
      }
    });
  }

  test("each preset has its own id", () => {
    expect(Object.values(PRESETS).map((make) => make().id)).toEqual([
      "opencode",
      "deep-agents",
      "hashline",
      "hermes",
    ]);
  });

  test("media ends with the image part, after any text part", async () => {
    for (const make of Object.values(PRESETS)) {
      const result = await tool(make())(CASES.media);
      expect(result.status).toBe("media");
      expect(result.content.map((part) => part.type)).toEqual(
        make().id === "deep-agents" ? ["media"] : ["text", "media"],
      );
    }
  });

  test('"view" mode gives the body with no notes', async () => {
    for (const make of Object.values(PRESETS)) {
      const formatter = make();
      const result = await tool(formatter)(CASES.truncated);
      const ctx: FormatContext<unknown> = {
        digest: null,
        limits: defaultLimits,
        mode: "view",
        call: { host: undefined },
      };
      const view = formatter.format(result, ctx);
      expect(typeof view).toBe("string");
      expect(view as string).not.toContain("Continue");
      expect(view as string).toContain("three");
    }
  });
});

describe("hermesFormat truncated flag", () => {
  test("a line clamped at EOF reports truncated: true with no next_offset", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/long": "abcdefghijk" } }),
      limits: { maxCharsPerLine: 3 },
      formatter: hermesFormat(),
    });
    const result = await read({ path: "/long" });
    const body = JSON.parse(render(result.content)) as Record<string, unknown>;
    expect(body.content).toBe("1|abc... [truncated]");
    expect(body.truncated).toBe(true);
    expect("next_offset" in body).toBe(false);
  });

  test("a whole file reports truncated: false", async () => {
    const read = createReadTool({
      fs: memoryFileSystem({ files: { "/a.txt": "one\ntwo\n" } }),
      formatter: hermesFormat(),
    });
    const body = JSON.parse(render((await read({ path: "/a.txt" })).content)) as Record<
      string,
      unknown
    >;
    expect(body.truncated).toBe(false);
  });
});

describe("hashlineFormat ids", () => {
  test("are stable across reads and change after an edit", async () => {
    const { read, fs } = harness({
      files: { "/a.txt": "one\ntwo\n" },
      deps: { formatter: hashlineFormat() },
    });
    const first = render((await read({ path: "/a.txt" })).content).split("\n");
    const second = render((await read({ path: "/a.txt" })).content).split("\n");
    expect(second).toEqual(first);

    fs.setFile("/a.txt", "one\nTWO\n");
    const edited = render((await read({ path: "/a.txt" })).content).split("\n");
    // Line 0 is the file hash, then one gutter per line.
    expect(edited[0]).not.toBe(first[0]);
    expect(edited[1]).toBe(first[1]);
    expect(edited[2]?.split("|")[0]).not.toBe(first[2]?.split("|")[0]);
  });

  test("the file hash header is absent when the scan is capped", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\nthree\nfour\n" },
      limits: { maxScanBytes: 8, sampleBytes: 8 },
      deps: { formatter: hashlineFormat() },
    });
    const text = render((await read({ path: "/a.txt", limit: 1 })).content);
    expect(text).not.toContain("file-hash");
    expect(text).not.toContain("End of file");
    expect(text).toMatch(/^1:[0-9a-f]{2}\|one\n\n\[read:continue\]/u);
  });
});

describe("same call object (plan section 8 rule)", () => {
  interface Host {
    readonly id: string;
  }

  const files = { "/a.txt": "one\n" };

  test("each preset gets the caller's call object through FormatContext.call", async () => {
    for (const make of Object.values(PRESETS)) {
      const preset = make();
      const seen: ReadContext<Host>[] = [];
      const spy: Formatter<Host> = {
        id: preset.id,
        format(outcome, ctx) {
          seen.push(ctx.call);
          return preset.format(outcome, ctx);
        },
      };
      const read = createReadTool<Host>({ fs: memoryFileSystem({ files }), formatter: spy });
      const call: ReadContext<Host> = { host: { id: "h1" } };
      await read({ path: "/a.txt" }, call);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(call);
    }
  });

  test("the gutter, header, and footer helpers get the same call object", async () => {
    const seen: unknown[] = [];
    const gutter = hashlineGutter();
    const header = fileHashHeader();
    const footer = eofFooter();
    const read = createReadTool<Host>({
      fs: memoryFileSystem({ files }),
      digest: testDigest(),
      formatter: lineNumberFormatter({
        gutter: (line, ctx) => (seen.push(ctx.call), gutter(line, ctx)),
        header: (outcome, ctx) => (seen.push(ctx.call), header(outcome, ctx)),
        footer: (outcome, ctx) => (seen.push(ctx.call), footer(outcome, ctx)),
      }),
    });
    const call: ReadContext<Host> = { host: { id: "h1" } };
    await read({ path: "/a.txt" }, call);
    expect(seen).toHaveLength(3);
    for (const entry of seen) expect(entry).toBe(call);
  });
});
