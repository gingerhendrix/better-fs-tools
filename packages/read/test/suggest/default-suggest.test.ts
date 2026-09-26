import { describe, expect, test } from "bun:test";

import type { DirectoryEntry } from "@better-fs-tools/fs";

import { defaultSuggest } from "../../src/index.ts";
import type { SuggestContext } from "../../src/index.ts";

function context(name: string, names: readonly string[], max = 5): SuggestContext<unknown> {
  const entries: DirectoryEntry[] = names.map((entry) => ({ name: entry, type: "file" }));
  return {
    path: `/d/${name}`,
    name,
    entries,
    entriesTruncated: false,
    max,
    call: { host: undefined },
  };
}

describe("defaultSuggest", () => {
  test("ranks a Unicode-equivalent name first", () => {
    const suggest = defaultSuggest();
    expect(suggest(context("report 2026.txt", ["report-2026.txt", "report 2026.txt"]))).toEqual([
      "report 2026.txt",
      "report-2026.txt",
    ]);
  });

  test("keeps every equivalent name, once each", () => {
    const suggest = defaultSuggest();
    expect(suggest(context("a b.txt", ["a b.txt", "a b.txt"]))).toEqual(["a b.txt", "a b.txt"]);
  });

  test("falls back to suggestFileNames, cut to max", () => {
    const suggest = defaultSuggest();
    expect(suggest(context("config.jsan", ["config.json", "other.md"]))).toEqual(["config.json"]);
    expect(suggest(context("a.txt", ["a.md", "a.ts", "a.js"], 2))).toHaveLength(2);
  });
});
