import { describe, expect, test } from "bun:test";

import { indentationMatcher } from "../../src/index.ts";
import { TEXT, hits } from "./helpers.ts";

describe("indentationMatcher", () => {
  const indentation = indentationMatcher();
  const haystack = "class A {\n    run() {\n        go();\n\n    }\n}\n";

  test("id and fuzzy flag", () => {
    expect([indentation.id, indentation.fuzzy]).toEqual(["indentation", true]);
  });

  test("matches a block with a different common indent", () => {
    expect(hits(indentation, haystack, "run() {\n    go();\n\n}")).toEqual([
      "    run() {\n        go();\n\n    }",
    ]);
  });

  test("the relative indent must be the same", () => {
    expect(indentation.find(haystack, "run() {\ngo();\n}", TEXT)).toEqual([]);
  });

  test("adapt shifts the new text by the indent difference", () => {
    const needle = "run() {\n    go();\n\n}";
    const [range] = indentation.find(haystack, needle, TEXT);
    if (range === undefined) throw new Error("no hit");
    const newText = "run() {\n    go();\n    stop();\n\n}";
    expect(indentation.adapt?.(newText, { haystack, needle, range })).toBe(
      "    run() {\n        go();\n        stop();\n\n    }",
    );
  });

  test("adapt removes indent when the match is shallower", () => {
    const shallow = "if (x) {\n  y();\n}\n";
    const needle = "    if (x) {\n      y();\n    }";
    const [range] = indentation.find(shallow, needle, TEXT);
    if (range === undefined) throw new Error("no hit");
    expect(
      indentation.adapt?.("    if (x) {\n      z();\n  w();\n    }", {
        haystack: shallow,
        needle,
        range,
      }),
    ).toBe("if (x) {\n  z();\nw();\n}");
  });

  test("blank needles find nothing", () => {
    expect(indentation.find(haystack, "\n\n", TEXT)).toEqual([]);
  });
});
