import { describe, expect, test } from "bun:test";

import {
  deepAgentsFormat,
  hashlineFormat,
  hermesFormat,
  opencodeFormat,
} from "@better-fs-tools/read/formats";

import { createPiReadTool } from "../src/index.ts";
import { execute, fixture, textOf } from "./helpers.ts";

describe("pi with the ./formats presets", () => {
  test("details take the view-mode body of each preset, with no notes", async () => {
    const root = await fixture({ "a.txt": "one\ntwo\nthree\n" });
    const views: Record<string, string | undefined> = {};
    for (const formatter of [
      opencodeFormat(),
      deepAgentsFormat(),
      hashlineFormat(),
      hermesFormat(),
    ]) {
      const result = await execute(
        createPiReadTool({ formatter }),
        { path: "a.txt", limit: 2 },
        root,
      );
      expect(textOf(result)).toContain("Continue with");
      expect(result.details.truncation?.truncatedBy).toBe("lines");
      views[formatter.id] = result.details.truncation?.content;
    }
    expect(views["opencode"]).toBe("1: one\n2: two");
    expect(views["deep-agents"]).toBe("one\ntwo");
    expect(views["hashline"]).toMatch(/^1:[0-9a-f]{2}\|one\n2:[0-9a-f]{2}\|two$/u);
    expect(JSON.parse(views["hermes"] ?? "")).toEqual({
      content: "1|one\n2|two",
      total_lines: 3,
      file_size: 14,
      truncated: true,
      next_offset: 3,
    });
  });

  test("hashline ids use Pi's default digest", async () => {
    const root = await fixture({ "a.txt": "one\n" });
    const result = await execute(
      createPiReadTool({ formatter: hashlineFormat() }),
      { path: "a.txt" },
      root,
    );
    expect(textOf(result)).toMatch(
      /^file-hash: sha256:[0-9a-f]{64}\n1:[0-9a-f]{2}\|one\n\(End of file - total 1 lines\)$/u,
    );
  });
});
