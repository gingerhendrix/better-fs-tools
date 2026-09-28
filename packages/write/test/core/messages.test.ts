import { describe, expect, test } from "bun:test";

import { defaultWriteMessages, resolveWriteMessages } from "../../src/index.ts";

describe("write messages", () => {
  test("the plan's key texts", () => {
    const m = defaultWriteMessages;
    expect(m.notRead({ tool: "write", path: "a.ts", wholeFile: false })).toBe(
      "Read a.ts with the read tool before changing it.",
    );
    expect(m.notRead({ tool: "write", path: "a.ts", wholeFile: true })).toBe(
      "Read all of a.ts before replacing it. A partial read is not enough for write.",
    );
    expect(m.stale({ tool: "write", path: "a.ts" })).toBe(
      "a.ts changed since it was last read. Read it again, then retry.",
    );
    expect(m.readBeforeWriteOff({ tool: "write" })).toBe(
      "Read-before-write is off: this tool has no state store.",
    );
    expect(m.notFound({ tool: "edit", path: "a.ts" })).toBe(
      "a.ts does not exist. Use the write tool to create it.",
    );
    expect(m.exists({ tool: "apply_patch", path: "a.ts" })).toBe(
      "a.ts already exists. Use *** Update File, or the write tool to replace it.",
    );
    expect(m.patchVerifyHeader()).toBe("Patch validation failed (no files were modified):");
  });

  test("tooLarge suggests edit only for an existing file", () => {
    const m = defaultWriteMessages;
    expect(m.tooLarge({ path: "a", what: "content", limit: 5, existing: true })).toContain(
      "edit tool",
    );
    expect(m.tooLarge({ path: "a", what: "content", limit: 5, existing: false })).not.toContain(
      "edit tool",
    );
  });

  test("a param override reaches every default text", () => {
    const messages = resolveWriteMessages({
      param: (name) => (name === "oldText" ? "old_string" : name),
    });
    expect(messages.noMatch({ path: "a", index: 0, closest: null, trailingNewline: null })).toBe(
      "Edit 1: the old_string was not found in a.",
    );
    expect(
      defaultWriteMessages.noMatch({ path: "a", index: 0, closest: null, trailingNewline: null }),
    ).toContain("oldText");
  });

  test("merges key by key and rejects bad overrides", () => {
    const messages = resolveWriteMessages({ stale: () => "custom" });
    expect(messages.stale({ tool: "write", path: "a" })).toBe("custom");
    expect(messages.notFound({ tool: "write", path: "a" })).toBe(
      defaultWriteMessages.notFound({ tool: "write", path: "a" }),
    );
    expect(() => resolveWriteMessages({ nope: () => "" } as never)).toThrow("Unknown message");
    expect(() => resolveWriteMessages({ stale: "x" } as never)).toThrow(TypeError);
  });

  test("no default text names a canonical parameter without param()", () => {
    const named = resolveWriteMessages({ param: (name) => `<${name}>` });
    const text = named.ambiguousMatch({ path: "a", index: 1, lines: [1, 2], total: 2 });
    expect(text).toContain("<oldText>");
    expect(text).toContain("<replaceAll>");
    expect(text).not.toMatch(/ oldText| replaceAll/u);
  });

  test("patch texts", () => {
    const m = defaultWriteMessages;
    expect(m.patchNotFound({ path: "a", operation: "update" })).toBe(
      "a does not exist. Use *** Add File to create it.",
    );
    expect(m.patchNotFound({ path: "a", operation: "delete" })).toBe(
      "a does not exist, so it cannot be deleted.",
    );
    expect(m.patchMoveExists({ path: "b", from: "a" })).toBe(
      "b already exists, so a cannot move there. Choose another path, or delete b first.",
    );
    expect(m.patchFuzzyMatch({ path: "a", hunk: 2, matcher: "normalized", lines: [3, 4] })).toBe(
      "Hunk 2 matched a at lines 3-4 only with the normalized matcher, not exactly. Check the result.",
    );
    expect(m.patchCommitFailed({ path: "b", code: "STALE", rolledBack: true, files: [] })).toBe(
      "Patch commit failed at b (STALE). The patch was rolled back. No files are changed.",
    );
    expect(
      m.patchCommitFailed({
        path: "b",
        code: "IO_ERROR",
        rolledBack: false,
        files: [
          { path: "a", state: "restored" },
          { path: "c", state: "rollback-failed" },
        ],
      }),
    ).toBe(
      "Patch commit failed at b (IO_ERROR). Rollback failed, so these files are in a mixed state:\nrestored a\nrollback-failed c",
    );
  });
});
