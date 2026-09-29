import type { ReadLimits } from "../../src/index.ts";

export const CORPUS_ROOT = "/corpus";

const ENCODER = new TextEncoder();
const text = (value: string): Uint8Array => ENCODER.encode(value);
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04);
const NARROW_NBSP = " ";

function lateInvalidUtf8(): Uint8Array {
  const out = new Uint8Array(9_000).fill(0x61);
  out[8_500] = 0xff;
  return out;
}

export const corpus: Readonly<Record<string, Uint8Array>> = {
  "plain.txt": text("one\ntwo\nthree\n"),
  "no-trailing-newline.txt": text("one\ntwo"),
  "crlf.txt": text("one\r\ntwo\r\nthree\r\n"),
  "bare-cr.txt": text("one\rtwo\rthree"),
  "mixed-endings.txt": text("one\r\ntwo\rthree\nfour"),
  "trailing-cr.txt": text("one\r"),
  "blank-lines.txt": text("\n\n\n"),
  "empty.txt": new Uint8Array(0),
  "bom.txt": concat(bytes(0xef, 0xbb, 0xbf), text("hello\nworld\n")),
  "multibyte.txt": text("héllo wörld\nsecond ✓ line\n"),
  "astral.txt": text("😀 face\n𝒳 math\n"),
  "long-line.txt": text(`${"x".repeat(2_500)}\nshort\n`),
  "many-long-lines.txt": text(Array.from({ length: 25 }, () => "y".repeat(2_100)).join("\n")),
  "many-lines.txt": text(
    Array.from({ length: 2_500 }, (_, index) => `line ${index + 1}`).join("\n"),
  ),
  "wide-lines.txt": text(`${Array.from({ length: 1_500 }, () => "w".repeat(99)).join("\n")}\n`),
  "source.ts": text(
    "export const answer = 42;\n\nexport function add(a: number, b: number) {\n  return a + b;\n}\n",
  ),
  [`report${NARROW_NBSP}2026.txt`]: text("narrow no-break space in the name\n"),
  "invalid-utf8.txt": bytes(0x61, 0xff, 0x62, 0x0a),
  "late-invalid-utf8.txt": lateInvalidUtf8(),
  "truncated-multibyte.txt": bytes(0x61, 0xe2, 0x82),
  "nul.bin": bytes(0x61, 0x00, 0x62),
  "image.png": concat(PNG, bytes(1, 2, 3)),
  "image.jpg": bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10),
  "image.gif": text("GIF89a\u0001\u0000"),
  "image.webp": concat(text("RIFF"), bytes(0x24, 0, 0, 0), text("WEBPVP8 ")),
  "document.pdf": text("%PDF-1.7\n%binary\n"),
  "report.docx": concat(ZIP, text("[Content_Types].xml word/document.xml")),
  "sheet.xlsx": concat(ZIP, text("xl/workbook.xml")),
  "bundle.zip": concat(ZIP, text("hello.txt")),
  "analysis.ipynb": text('{"cells": [], "nbformat": 4, "metadata": {}}\n'),
  "icon.svg": text('<svg xmlns="http://www.w3.org/2000/svg"></svg>\n'),
};

export const corpusDirectories: readonly string[] = [`${CORPUS_ROOT}/folder`];

export interface CorpusRequest {
  readonly id: string;
  readonly input: { readonly path: string; readonly offset?: number; readonly limit?: number };
  readonly limits?: Partial<ReadLimits>;
}

const at = (name: string): string => `${CORPUS_ROOT}/${name}`;

export const corpusRequests: readonly CorpusRequest[] = [
  ...Object.keys(corpus).map((name) => ({ id: `file ${name}`, input: { path: at(name) } })),
  { id: "range interior", input: { path: at("plain.txt"), offset: 2, limit: 1 } },
  { id: "range to end", input: { path: at("plain.txt"), offset: 2 } },
  { id: "range offset past eof", input: { path: at("plain.txt"), offset: 9 } },
  { id: "range late window", input: { path: at("many-lines.txt"), offset: 2_490, limit: 20 } },
  { id: "range crlf window", input: { path: at("crlf.txt"), offset: 3, limit: 5 } },
  {
    id: "limit clamped to maxLines",
    input: { path: at("plain.txt"), limit: 50 },
    limits: { maxLines: 2 },
  },
  {
    id: "small maxCharsPerLine",
    input: { path: at("long-line.txt") },
    limits: { maxCharsPerLine: 5 },
  },
  {
    id: "small maxViewBytes",
    input: { path: at("plain.txt") },
    limits: { maxViewBytes: 8 },
  },
  {
    id: "first line over maxViewBytes",
    input: { path: at("long-line.txt") },
    limits: { maxViewBytes: 4 },
  },
  {
    id: "small maxScanBytes",
    input: { path: at("plain.txt") },
    limits: { maxScanBytes: 6, sampleBytes: 3 },
  },
  {
    id: "offset unreached by scan",
    input: { path: at("plain.txt"), offset: 50 },
    limits: { maxScanBytes: 6, sampleBytes: 3 },
  },
  { id: "missing file", input: { path: at("missing.txt") } },
  { id: "near miss name", input: { path: at("plain.tx") } },
  { id: "unicode-equivalent miss", input: { path: at("report 2026.txt") } },
  { id: "directory", input: { path: at("folder") } },
];
