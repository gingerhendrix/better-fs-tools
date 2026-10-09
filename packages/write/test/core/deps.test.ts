import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { memoryStore } from "@better-fs-tools/read";

import {
  resolveApplyPatchDependencies,
  resolveEditDependencies,
  resolveWriteDependencies,
} from "../../src/core/deps.ts";
import {
  createApplyPatchTool,
  createEditTool,
  createWriteTool,
  exactMatcher,
  defaultPreconditions,
  defaultWriteLimits,
  defaultWriteMessages,
} from "../../src/index.ts";
import { codexPatchParser } from "../../src/patch/index.ts";
import { testDigest } from "../helpers.ts";

const fs = memoryFileSystem();

describe("write tool dependencies", () => {
  test("defaults", () => {
    const deps = resolveWriteDependencies({ fs }, "write");
    expect(deps.limits).toEqual(defaultWriteLimits);
    expect(deps.messages.stale({ tool: "write", path: "a" })).toBe(
      defaultWriteMessages.stale({ tool: "write", path: "a" }),
    );
    expect(deps.preconditions).toEqual(defaultPreconditions);
    expect(deps.preconditions).toEqual({
      requireRead: "existing",
      partialRead: "edit-only",
      onStale: "reject",
    });
    expect([deps.resolve, deps.authorize, deps.state, deps.digest]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(deps.locks.id).toBe("memory");
    expect(deps.classifiers.length).toBeGreaterThan(0);
    expect(deps.codecs.map((codec) => codec.id)).toEqual(["utf-8"]);
    expect(deps.guards.map((guard) => guard.id)).toEqual([
      "read-prefix",
      "truncation-notice",
      "omission",
      "syntax",
      "non-text",
    ]);
    expect(resolveWriteDependencies({ fs, guards: [] }, "write").guards).toEqual([]);
    expect(deps.hooks).toEqual([]);
    expect(deps.formatter.id).toBe("default");
  });

  test("each tool instance gets its own lock manager", () => {
    const a = resolveWriteDependencies({ fs }, "write");
    const b = resolveWriteDependencies({ fs }, "write");
    expect(a.locks).not.toBe(b.locks);
  });

  test("limits, messages, and preconditions merge key by key", () => {
    const deps = resolveWriteDependencies(
      {
        fs,
        limits: { maxEdits: 2 },
        messages: { stale: () => "s" },
        preconditions: { onStale: "rematch" },
      },
      "write",
    );
    expect(deps.limits.maxEdits).toBe(2);
    expect(deps.limits.maxFileBytes).toBe(defaultWriteLimits.maxFileBytes);
    expect(deps.messages.stale({ tool: "write", path: "a" })).toBe("s");
    expect(deps.preconditions).toEqual({ ...defaultPreconditions, onStale: "rematch" });
  });

  test.each([
    ["an unknown key", { fs, matchers: [] }, "Unknown write tool dependency: matchers"],
    ["a missing fs", {}, "fs must be"],
    ["a read-only fs", { fs: { id: "ro", open: async () => ({}) } }, "fs has no write methods"],
    ["state without a digest", { fs, state: memoryStore() }, "state needs a digest"],
    ["an empty classifier list", { fs, classifiers: [] }, "classifiers"],
    ["an empty codec list", { fs, codecs: [] }, "codecs"],
    ["a malformed codec", { fs, codecs: [{ id: "x" }] }, "codecs"],
    ["a malformed guard", { fs, guards: [{ id: "g" }] }, "guards"],
    [
      "a hook with a newFileMode that is not a function",
      { fs, hooks: [{ id: "h", afterWrite: () => ({}), newFileMode: 1 }] },
      "hooks",
    ],
    ["a malformed hook", { fs, hooks: [{ id: "h" }] }, "hooks"],
    ["a malformed lock manager", { fs, locks: {} }, "locks"],
    ["a malformed authorizer", { fs, authorize: {} }, "authorize"],
    ["a malformed resolver", { fs, resolve: {} }, "resolve"],
    ["a malformed formatter", { fs, formatter: {} }, "formatter"],
    ["a malformed digest", { fs, digest: {} }, "digest"],
    ["an unknown policy key", { fs, preconditions: { strict: true } }, "Unknown precondition"],
    ["a bad policy value", { fs, preconditions: { onStale: "retry" } }, "onStale"],
    ["a bad limit", { fs, limits: { maxEdits: -1 } }, "maxEdits"],
  ])("rejects %s", (_name, deps, message) => {
    expect(() => createWriteTool(deps as never)).toThrow(message);
  });

  test("a store with a digest is accepted", () => {
    expect(() => createWriteTool({ fs, state: memoryStore(), digest: testDigest() })).not.toThrow();
  });

  test("edit: matchers default to defaultEditMatchers() and replace as a whole", () => {
    expect(resolveEditDependencies({ fs }).matchers.map((matcher) => matcher.id)).toEqual([
      "exact",
      "normalized",
      "escape",
    ]);
    expect(
      resolveEditDependencies({ fs, matchers: undefined }).matchers.map((matcher) => matcher.id),
    ).toEqual(["exact", "normalized", "escape"]);
    const exact = exactMatcher();
    expect(resolveEditDependencies({ fs, matchers: [exact] }).matchers).toEqual([exact]);
  });

  test.each([
    ["an empty matcher list", { fs, matchers: [] }, "matchers"],
    ["a malformed matcher", { fs, matchers: [{ id: "m", find: () => [] }] }, "matchers"],
    ["a bad adapt", { fs, matchers: [{ ...exactMatcher(), adapt: 1 }] }, "matchers"],
    ["an unknown key", { fs, patchParser: {} }, "Unknown edit tool dependency: patchParser"],
    ["a shared rule", { fs, state: memoryStore() }, "state needs a digest"],
  ])("edit rejects %s", (_name, deps, message) => {
    expect(() => createEditTool(deps as never)).toThrow(message);
  });

  test("apply_patch: matchers default to defaultPatchMatchers() and the parser to codexPatchParser()", () => {
    const deps = resolveApplyPatchDependencies({ fs });
    expect(deps.matchers.map((matcher) => matcher.id)).toEqual([
      "exact",
      "normalized",
      "line-trimmed",
    ]);
    expect(deps.patchParser.id).toBe("codex");
    expect(deps.guards.length).toBe(5);
    const parser = codexPatchParser();
    expect(resolveApplyPatchDependencies({ fs, patchParser: parser }).patchParser).toBe(parser);
  });

  test.each([
    ["an empty matcher list", { fs, matchers: [] }, "matchers"],
    ["a malformed parser", { fs, patchParser: { id: "p" } }, "patchParser"],
    ["a parser without an id", { fs, patchParser: { parse: () => null } }, "patchParser"],
    ["an unknown key", { fs, replaceAll: true }, "Unknown apply_patch tool dependency: replaceAll"],
    ["a shared rule", { fs, codecs: [] }, "codecs"],
  ])("apply_patch rejects %s", (_name, deps, message) => {
    expect(() => createApplyPatchTool(deps as never)).toThrow(message);
  });
});
