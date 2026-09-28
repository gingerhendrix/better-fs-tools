import { describe, expect, test } from "bun:test";

import { textOf } from "../../src/index.ts";
import {
  defaultReadSignature,
  lineRangeSignature,
  readSignatureMessages,
} from "../../src/signature/index.ts";
import { expectOk, harness, note } from "../helpers.ts";

const range = lineRangeSignature({
  names: { path: "file_path", start: "start_line", end: "end_line" },
});

describe("readSignatureMessages", () => {
  test("overrides retry only", () => {
    const messages = readSignatureMessages(range);
    expect(Object.keys(messages)).toEqual(["retry"]);
    expect(messages.retry({ path: "a.txt", offset: 3, limit: 2 })).toBe(
      '{"file_path":"a.txt","start_line":3,"end_line":4}',
    );
    expect(readSignatureMessages(defaultReadSignature()).retry({ path: "a.txt", offset: 3 })).toBe(
      '{"path":"a.txt","offset":3}',
    );
  });

  test("refuses something that is not a signature", () => {
    expect(() => readSignatureMessages({} as never)).toThrow(TypeError);
  });

  test("continuation text uses host names and continuation.next stays canonical", async () => {
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\nthree\nfour\n" },
      deps: { messages: readSignatureMessages(range) },
    });
    const result = expectOk(await read(range.toInput({ file_path: "/a.txt", end_line: 2 })));

    expect(result.continuation.next).toEqual({ path: "/a.txt", offset: 3, limit: 2 });
    expect(result.request).toMatchObject({ path: "/a.txt", offset: 1, limit: 2 });
    const continuation = note(result, "continue");
    expect(continuation?.retry).toEqual({ path: "/a.txt", offset: 3, limit: 2 });
    expect(continuation?.message).toContain('{"file_path":"/a.txt","start_line":3,"end_line":4}');
    expect(textOf(result)).not.toContain('"offset"');
  });

  test("every retry note in a renamed tool prints host names", async () => {
    const renamed = defaultReadSignature({
      names: { path: "file", offset: "from", limit: "count" },
    });
    const { read } = harness({
      files: { "/a.txt": "one\ntwo\n", "/long.txt": `${"x".repeat(40)}\nshort\n` },
      limits: { maxViewBytes: 8 },
      deps: { messages: readSignatureMessages(renamed) },
    });

    const past = await read({ path: "/a.txt", offset: 9 });
    expect(note(past, "offset-past-eof")?.message).toContain(
      '{"file":"/a.txt","from":2,"count":2000}',
    );
    expect(note(past, "offset-past-eof")?.retry).toEqual({
      path: "/a.txt",
      offset: 2,
      limit: 2_000,
    });

    const first = await read({ path: "/long.txt" });
    const tooLong = note(first, "first-line-exceeds-byte-limit");
    expect(tooLong?.message).toContain('{"file":"/long.txt","from":2,"count":2000}');
    expect(tooLong?.retry).toEqual({ path: "/long.txt", offset: 2, limit: 2_000 });
  });
});
