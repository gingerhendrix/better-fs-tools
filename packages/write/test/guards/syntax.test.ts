import { describe, expect, test } from "bun:test";

import { syntaxGuard, recommendedGuards } from "../../src/index.ts";
import { errorOf, errorCode, harness, text } from "../helpers.ts";
import { change, guardContext, verdict } from "./helpers.ts";

function check(path: string, before: string | null, after: string, guard = syntaxGuard()) {
  return verdict(guard.check(change({ path, before, after }), guardContext()));
}

describe("syntaxGuard", () => {
  test("refuses an update that breaks valid JSON", () => {
    expect(check("/p.json", '{"a": 1}\n', '{"a": 1,}\n')).toBe("syntax");
    expect(check("/P.JSON", '{"a": 1}\n', '{"a": \n')).toBe("syntax");
  });

  test("near miss: a file that was already broken", () => {
    expect(check("/p.json", '{"a": 1,}\n', '{"a": 2,}\n')).toBe("allow");
  });

  test("near miss: a create, such as a JSONC tsconfig.json", () => {
    const tsconfig = '{\n  // comment\n  "compilerOptions": {},\n}\n';
    expect(check("/tsconfig.json", null, tsconfig)).toBe("allow");
  });

  test("valid JSON after, and files with no parser, pass", () => {
    expect(check("/p.json", '{"a": 1}\n', '{"a": 2}\n')).toBe("allow");
    expect(check("/p.txt", '{"a": 1}\n', "{")).toBe("allow");
    expect(check("/Makefile", "a:\n", "{")).toBe("allow");
  });

  test("host parsers by extension, with or without the dot", () => {
    const yaml = (value: string) => {
      if (value.includes("\t")) throw new Error("tabs are not allowed\nsecond line");
    };
    const guard = syntaxGuard({ parsers: { ".yaml": yaml, YML: yaml } });
    expect(check("/c.yaml", "a: 1\n", "a:\t1\n", guard)).toBe("syntax");
    expect(check("/c.yml", "a: 1\n", "a:\t1\n", guard)).toBe("syntax");
    expect(check("/p.json", "{}", "{", guard)).toBe("syntax");
    const decision = guard.check(
      change({ path: "/c.yaml", before: "a: 1\n", after: "a:\t1\n" }),
      guardContext(),
    );
    expect(decision).toEqual({
      allow: false,
      note: {
        code: "syntax",
        severity: "warning",
        message:
          "The change would make /c.yaml invalid YAML, and it was valid before. Fix the content and retry. The parser said: tabs are not allowed",
        data: { language: "YAML", detail: "tabs are not allowed" },
      },
    });
  });

  test("a host parser can replace the JSON default", () => {
    const guard = syntaxGuard({ parsers: { json: () => {} } });
    expect(check("/p.json", "{}", "{", guard)).toBe("allow");
  });

  test("rejects bad options", () => {
    expect(() => syntaxGuard({ parsers: { json: "x" as never } })).toThrow(TypeError);
    expect(() => syntaxGuard({ parsers: [] as never })).toThrow(TypeError);
  });

  test("in recommendedGuards() for edit", async () => {
    const { fs, read, edit } = harness({
      files: { "/p.json": '{"a": 1}\n' },
      deps: { guards: recommendedGuards() },
    });
    await read({ path: "/p.json" });
    const result = await edit({ path: "/p.json", edits: [{ oldText: "1}", newText: "1,}" }] });
    expect(errorCode(result)).toBe("GUARD_REFUSED");
    expect(errorOf(result)?.data).toMatchObject({ guard: "syntax", language: "JSON" });
    expect(text(fs, "/p.json")).toBe('{"a": 1}\n');
  });
});
