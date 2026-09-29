import { describe, expect, test } from "bun:test";

import { generateDiffString } from "@earendil-works/pi-coding-agent";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { createApplyPatchTool, createEditTool, createWriteTool } from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";

import { toPiMutationDetails } from "../src/index.ts";

const BEFORE = "one\ntwo\nthree\nfour\nfive\n";

async function edited(before: string, oldText: string, newText: string): Promise<MutationResult> {
  const fs = memoryFileSystem({ files: { "/f.txt": before } });
  return createEditTool({ fs })({ path: "/f.txt", edits: [{ oldText, newText }] });
}

describe("toPiMutationDetails", () => {
  // Short files, so Pi's four context lines and the unified diff's three show the same lines.
  for (const [label, oldText, newText] of [
    ["a changed line", "three", "THREE"],
    ["an added line", "three\n", "three\n3.5\n"],
    ["a removed line", "two\n", ""],
  ] as const) {
    test(`matches Pi's generateDiffString for ${label} in a short file`, async () => {
      const result = await edited(BEFORE, oldText, newText);
      const after = BEFORE.replace(oldText, newText);
      const pi = generateDiffString(BEFORE, after);
      expect(toPiMutationDetails(result)).toEqual({
        diff: pi.diff,
        patch: result.changes[0]?.diff as string,
        firstChangedLine: pi.firstChangedLine as number,
      });
    });
  }

  test("joins separate hunks with a ... row", async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const fs = memoryFileSystem({ files: { "/f.txt": `${lines.join("\n")}\n` } });
    const result = await createEditTool({ fs })({
      path: "/f.txt",
      edits: [
        { oldText: "line 2\n", newText: "LINE 2\n" },
        { oldText: "line 19\n", newText: "LINE 19\n" },
      ],
    });
    expect(toPiMutationDetails(result)?.diff.split("\n")).toEqual([
      "  1 line 1",
      "- 2 line 2",
      "+ 2 LINE 2",
      "  3 line 3",
      "  4 line 4",
      "  5 line 5",
      "    ...",
      " 16 line 16",
      " 17 line 17",
      " 18 line 18",
      "-19 line 19",
      "+19 LINE 19",
      " 20 line 20",
    ]);
    expect(toPiMutationDetails(result)?.firstChangedLine).toBe(2);
  });

  test("an apply_patch result names each file above its lines", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "a\n", "/old.txt": "o\n" } });
    const result = await createApplyPatchTool({ fs })({
      patch: [
        "*** Begin Patch",
        "*** Update File: /a.txt",
        "@@",
        "-a",
        "+A",
        "*** Update File: /old.txt",
        "*** Move to: /new.txt",
        "@@",
        "-o",
        "+O",
        "*** End Patch",
      ].join("\n"),
    });
    const details = toPiMutationDetails(result);
    expect(details?.diff).toBe("/a.txt\n-1 a\n+1 A\n/old.txt → /new.txt\n-1 o\n+1 O");
    expect(details?.patch).toBe(result.changes.map((change) => change.diff).join(""));
  });

  test("gives undefined for an error, a no-change result, and a result with no changes", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "a\n" } });
    const error = await createEditTool({ fs })({
      path: "/a.txt",
      edits: [{ oldText: "zzz", newText: "y" }],
    });
    const same = await createWriteTool({ fs })({ path: "/a.txt", content: "a\n" });
    expect(error.status).toBe("error");
    expect(same.status).toBe("no-change");
    expect(toPiMutationDetails(error)).toBeUndefined();
    expect(toPiMutationDetails(same)).toBeUndefined();
  });

  test("a create shows every line as added from line 1", async () => {
    const fs = memoryFileSystem();
    const result = await createApplyPatchTool({ fs })({
      patch: "*** Begin Patch\n*** Add File: /n.txt\n+x\n+y\n*** End Patch",
    });
    expect(toPiMutationDetails(result)).toEqual({
      diff: "+1 x\n+2 y",
      patch: "--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+x\n+y\n",
      firstChangedLine: 1,
    });
  });
});
