import { describe, expect, test } from "bun:test";

import { defaultReadMessages, resolveReadMessages, textOf } from "../../src/index.ts";
import type { ReadRequest } from "../../src/index.ts";
import { expectOk, harness, note } from "../helpers.ts";

const request: ReadRequest = { path: "a.txt", offset: 4, limit: 2, ranged: true };

describe("resolveReadMessages", () => {
  test("merges by key and keeps note codes stable", async () => {
    const messages = resolveReadMessages({ empty: ({ path }) => `nothing in ${path}` });
    expect(messages.empty({ path: "a.txt" })).toBe("nothing in a.txt");
    expect(messages.scanLimit).toBe(defaultReadMessages.scanLimit);

    const { read } = harness({
      files: { "/e.txt": "" },
      deps: { messages: { empty: () => "custom" } },
    });
    const result = await read({ path: "/e.txt" });
    expect(result.notes[0]?.code).toBe("empty");
    expect(result.notes[0]?.message).toBe("custom");
  });

  test("an undefined override keeps the default", () => {
    expect(resolveReadMessages({ empty: undefined }).empty).toBe(defaultReadMessages.empty);
  });

  test("an unknown key or a non-function is refused", () => {
    expect(() => resolveReadMessages({ nope: () => "" } as never)).toThrow(TypeError);
    expect(() => resolveReadMessages({ ambiguousRepair: () => "" } as never)).toThrow(TypeError);
    expect(() => resolveReadMessages({ empty: "text" } as never)).toThrow(TypeError);
  });
});

describe("not-found and repair wording", () => {
  test("notFound lists quoted suggestions only when there are some", () => {
    expect(defaultReadMessages.notFound({ request, suggestions: [] })).toBe("a.txt was not found.");
    expect(defaultReadMessages.notFound({ request, suggestions: ["a.ts", 'b "c".txt'] })).toBe(
      'a.txt was not found. Nearby names: "a.ts", "b \\"c\\".txt".',
    );
  });

  test("pathRepaired names both paths", () => {
    expect(defaultReadMessages.pathRepaired({ from: "/d/a b.txt", to: "/d/a\u202fb.txt" })).toBe(
      'The requested filename "/d/a b.txt" was repaired to the unique Unicode-equivalent path "/d/a\u202fb.txt".',
    );
  });
});

describe("retry text", () => {
  test("no default message names offset or limit", () => {
    const retry = "<retry>";
    const texts = [
      defaultReadMessages.continuation({ request, retry, reason: "lines" }),
      defaultReadMessages.firstLineTooLong({ line: 4, maxViewBytes: 8, retry }),
      defaultReadMessages.offsetPastEof({ request, totalLines: 3, retry }),
      defaultReadMessages.offsetUnreached({ request, reachedLine: 2, retry }),
      defaultReadMessages.changedDuringRead({ request, retry }),
    ];
    for (const text of texts) {
      expect(text).toContain(retry);
      // "line limit" is wording; a parameter would appear as offset or limit with a value.
      expect(text).not.toMatch(/offset/iu);
      expect(text).not.toMatch(/\blimit\s*[:=]|\blimit \d/iu);
    }
  });

  test("messages.retry prints every retry the core suggests", async () => {
    const { read } = harness({
      files: { "/a.txt": "1\n2\n3\n" },
      deps: { messages: { retry: (next) => `read(${next.path}, from ${next.offset})` } },
    });
    const result = expectOk(await read({ path: "/a.txt", limit: 1 }));
    expect(textOf(result)).toContain("Continue with read(/a.txt, from 2).");
    expect(note(result, "continue")?.retry).toEqual({ path: "/a.txt", offset: 2, limit: 1 });
  });
});
