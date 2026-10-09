import { describe, expect, test } from "bun:test";

import { defaultEditMatchers, defaultPatchMatchers } from "../../src/index.ts";

describe("default matcher chains", () => {
  test("edit: exact, normalized", () => {
    expect(defaultEditMatchers().map((matcher) => matcher.id)).toEqual(["exact", "normalized"]);
  });

  test("patch: exact, normalized, line-trimmed", () => {
    expect(defaultPatchMatchers().map((matcher) => matcher.id)).toEqual([
      "exact",
      "normalized",
      "line-trimmed",
    ]);
  });

  test("each call gives new instances", () => {
    expect(defaultEditMatchers()[1]).not.toBe(defaultEditMatchers()[1]);
  });
});
