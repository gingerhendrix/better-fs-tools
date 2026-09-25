import { describe, expect, test } from "bun:test";

import { plainFormatter, textOf } from "../../src/index.ts";
import { harness } from "../helpers.ts";

describe("plainFormatter", () => {
  test("plain output is byte-exact source", async () => {
    const { read } = harness({
      files: { "/a.txt": "alpha\nbeta\n" },
      deps: { formatter: plainFormatter() },
    });
    expect(textOf(await read({ path: "/a.txt" }))).toBe("alpha\nbeta");
  });

  test("plain output has no clamp marker", async () => {
    const { read } = harness({
      files: { "/a.txt": "abcdefgh\n" },
      limits: { maxCharsPerLine: 3 },
      deps: { formatter: plainFormatter({ notes: () => null }) },
    });
    expect(textOf(await read({ path: "/a.txt" }))).toBe("abc");
  });

  test("plain output can drop notes entirely", async () => {
    const { read } = harness({
      files: { "/a.txt": "alpha\nbeta\n" },
      limits: { maxLines: 1 },
      deps: { formatter: plainFormatter({ notes: () => null }) },
    });
    const result = await read({ path: "/a.txt" });
    expect(textOf(result)).toBe("alpha");
    expect(result.notes.length).toBeGreaterThan(0);
  });
});
