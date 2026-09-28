import { describe, expect, test } from "bun:test";

import { escapeMatcher } from "../../src/index.ts";
import { LINES, TEXT, hits } from "./helpers.ts";

describe("escapeMatcher", () => {
  const escape = escapeMatcher();
  const range = { start: 0, end: 1 };

  test("id and fuzzy flag", () => {
    expect([escape.id, escape.fuzzy]).toEqual(["escape", true]);
  });

  test('unescapes \\n, \\t, \\", \\\\, and \\uXXXX in the needle', () => {
    const haystack = 'if (a) {\n\treturn "x\\\\y";\n}\n';
    expect(hits(escape, haystack, 'if (a) {\\n\\treturn \\"x\\\\\\\\y\\";\\n}')).toEqual([
      'if (a) {\n\treturn "x\\\\y";\n}',
    ]);
    expect(hits(escape, "caf\u00e9", "caf\\u00e9")).toEqual(["caf\u00e9"]);
  });

  test("runs only when the needle holds an escape", () => {
    expect(escape.find("a\nb", "a\nb", TEXT)).toEqual([]);
    expect(escape.find("a\\qb", "a\\qb", TEXT)).toEqual([]);
  });

  test("lines mode keeps line-aligned hits", () => {
    expect(hits(escape, "x a\nb\na\nb\n", "a\\nb", LINES)).toEqual(["a\nb"]);
  });

  test("adapt unescapes the same sequences in the new text", () => {
    const hit = { haystack: "x", needle: "x", range };
    expect(escape.adapt?.('say(\\"hi\\")\\n\\tdone \\u00e9 \\q', hit)).toBe(
      'say("hi")\n\tdone \u00e9 \\q',
    );
    expect(escape.adapt?.("plain", hit)).toBe("plain");
  });
});
