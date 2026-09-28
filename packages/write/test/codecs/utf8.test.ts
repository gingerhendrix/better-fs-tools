import { describe, expect, test } from "bun:test";

import { utf8Codec } from "../../src/index.ts";

const codec = utf8Codec();
const bytes = (text: string) => new TextEncoder().encode(text);
const sample = (value: Uint8Array, complete = true) => ({
  bytes: value,
  complete,
  path: "f.txt",
  mimeType: null,
});

describe("utf8Codec", () => {
  test.each([
    ["LF", "a\nb\n", "lf"],
    ["no line break", "abc", "lf"],
    ["CRLF", "a\r\nb\r\n", "crlf"],
    ["mixed", "a\r\nb\n", "keep"],
    ["a lone CR in an LF file", "a\rb\nc\n", "lf"],
  ] as const)("%s decodes to eol %s and round-trips", (_name, source, eol) => {
    const decoded = codec.decode(bytes(source));
    if (!decoded.ok) throw new Error("decode failed");
    expect(decoded.style).toEqual({ encoding: "utf-8", bom: false, eol });
    expect(codec.encode(decoded.text, decoded.style)).toEqual(bytes(source));
  });

  test("CRLF text is LF in text space", () => {
    const decoded = codec.decode(bytes("a\r\nb\r\n"));
    expect(decoded.ok && decoded.text).toBe("a\nb\n");
  });

  test("keeps a BOM", () => {
    const source = Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes("hi\r\n"));
    const decoded = codec.decode(source);
    if (!decoded.ok) throw new Error("decode failed");
    expect(decoded.text).toBe("hi\n");
    expect(decoded.style).toEqual({ encoding: "utf-8", bom: true, eol: "crlf" });
    expect(codec.encode("hi\nthere\n", decoded.style)).toEqual(
      Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes("hi\r\nthere\r\n")),
    );
  });

  test("invalid UTF-8 fails to decode and is not accepted", () => {
    const bad = Uint8Array.of(0x61, 0xff, 0x62);
    expect(codec.decode(bad)).toEqual({ ok: false, detail: "invalid UTF-8" });
    expect(codec.accepts(sample(bad))).toBe(false);
  });

  test("accepts a partial sample cut inside a character", () => {
    const cut = bytes("aé").subarray(0, 2);
    expect(codec.accepts(sample(cut, false))).toBe(true);
    expect(codec.accepts(sample(cut, true))).toBe(false);
  });

  test("new files: no BOM, no conversion", () => {
    expect(codec.newFileStyle).toEqual({ encoding: "utf-8", bom: false, eol: "keep" });
    expect(codec.encode("a\r\nb\n", codec.newFileStyle)).toEqual(bytes("a\r\nb\n"));
  });
});
