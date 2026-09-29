import { describe, expect, test } from "bun:test";

import { placed, spliceAll } from "../../src/core/splice.ts";
import { harness, text } from "../helpers.ts";

describe("literal splice", () => {
  test("replacement patterns stay literal", () => {
    const source = "const price = PRICE;\n";
    for (const pattern of ["$&", "$$", "$1", "$`", "$'", "$<name>"]) {
      expect(spliceAll(source, [{ start: 14, end: 19, text: pattern }])).toBe(
        `const price = ${pattern};\n`,
      );
    }
  });

  test("the edit tool keeps $&, $$, $1, and $` literal", async () => {
    const { read, edit, fs } = harness({ files: { "/a.js": "let s = X;\nlet t = Y;\n" } });
    await read({ path: "/a.js" });
    const result = await edit({
      path: "/a.js",
      edits: [
        { oldText: "X", newText: "'$&$$'" },
        { oldText: "Y", newText: "'$1$`'" },
      ],
    });
    expect(result.status).toBe("ok");
    expect(text(fs, "/a.js")).toBe("let s = '$&$$';\nlet t = '$1$`';\n");
  });

  test("splices apply from the end, so earlier offsets hold", () => {
    const splices = [
      { start: 0, end: 1, text: "AAA" },
      { start: 2, end: 3, text: "" },
      { start: 4, end: 5, text: "E\nE" },
    ];
    expect(spliceAll("a-b-c", splices)).toBe("AAA--E\nE");
    expect(placed(splices)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 4 },
      { start: 5, end: 8 },
    ]);
  });

  test("no splices give the text back", () => {
    expect(spliceAll("same", [])).toBe("same");
  });
});
