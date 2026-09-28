import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";

import { createApplyPatchTool, createWriteTool } from "../../src/index.ts";
import type { WriteFormatter } from "../../src/index.ts";

const broken: WriteFormatter<unknown> = {
  id: "broken",
  format: () => {
    throw new Error("format failed");
  },
};

describe("formatter failure", () => {
  test("a throwing formatter after a commit keeps the status, the changes, and the file", async () => {
    const fs = memoryFileSystem();
    const write = createWriteTool({ fs, formatter: broken });

    const result = await write({ path: "/new.txt", content: "already committed\n" });

    expect(result.status).toBe("ok");
    expect(result.error).toBeNull();
    expect(result.changes.map((change) => [change.kind, change.path])).toEqual([
      ["create", "/new.txt"],
    ]);
    expect(new TextDecoder().decode(fs.peek("/new.txt")?.bytes)).toBe("already committed\n");
    expect(result.notes.at(-1)).toEqual({
      code: "extension-failed",
      severity: "warning",
      message: "The broken formatter failed, so the default formatter formatted this result.",
      data: { extension: "formatter", id: "broken" },
    });
    expect(textOf(result)).toContain("/new.txt");
    expect(textOf(result)).toContain("[write:extension-failed]");
  });

  test("a formatter that returns neither a string nor an array falls back too", async () => {
    const wrong = { id: "wrong", format: () => null } as unknown as WriteFormatter<unknown>;
    const fs = memoryFileSystem({ files: { "/a.txt": "one\n" } });
    const applyPatch = createApplyPatchTool({ fs, formatter: wrong });

    const result = await applyPatch({
      patch: "*** Begin Patch\n*** Delete File: /a.txt\n*** End Patch",
    });

    expect(result.status).toBe("ok");
    expect(result.changes.map((change) => change.kind)).toEqual(["delete"]);
    expect(result.notes.map((note) => note.code)).toContain("extension-failed");
    expect(textOf(result)).not.toBe("");
  });
});
