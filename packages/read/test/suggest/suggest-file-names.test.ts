import { describe, expect, test } from "bun:test";

import { suggestFileNames } from "../../src/index.ts";

describe("suggestFileNames", () => {
  test("suggestions are ranked and bounded", () => {
    const names = ["config.json", "config.jsonc", "configure.sh", "unrelated.md", "conflg.json"];
    expect(suggestFileNames("config.json", names, 3)).toEqual([
      "config.json",
      "config.jsonc",
      "conflg.json",
    ]);
    expect(suggestFileNames("zzzzzzzzzz.bin", names, 5)).toEqual([]);
  });

  test("a stem match ranks before an edit-distance match", () => {
    expect(suggestFileNames("readme.txt", ["readme.md", "readmy.txt"], 5)).toEqual([
      "readme.md",
      "readmy.txt",
    ]);
  });
});
