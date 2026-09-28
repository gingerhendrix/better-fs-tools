import { describe, expect, spyOn, test } from "bun:test";

import { denyPaths } from "@better-fs-tools/read";

import type {
  Guard,
  PlannedChange,
  WriteAuthorizer,
  WriteAuthorizeTarget,
} from "../../src/index.ts";
import { errorOf, codes, errorCode, harness, note, text } from "../helpers.ts";

function recording(
  decide: (target: WriteAuthorizeTarget) => ReturnType<WriteAuthorizer<unknown>["authorize"]>,
) {
  const targets: WriteAuthorizeTarget[] = [];
  const authorizer: WriteAuthorizer<unknown> = {
    id: "recording",
    authorize: (target) => {
      targets.push(target);
      return decide(target);
    },
  };
  return { authorizer, targets };
}

describe("authorize (sections 5.2 and 5.8)", () => {
  test("the access stage runs before load, and a denial never opens the file", async () => {
    const { authorizer, targets } = recording(() => ({ allow: false }));
    const { fs, read, write } = harness({
      files: { "/a.txt": "one\n" },
      deps: { authorize: authorizer },
    });
    await read({ path: "/a.txt" });
    const open = spyOn(fs, "open");
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "DENIED",
      phase: "authorize",
    });
    expect(note(result, "denied")?.message).toBe("/a.txt was refused by policy.");
    expect(open).not.toHaveBeenCalled();
    expect(targets).toEqual([
      {
        action: "update",
        tool: "write",
        requestedPath: "/a.txt",
        resolvedPath: "/a.txt",
        displayPath: "/a.txt",
        change: null,
        plan: [],
      },
    ]);
  });

  test("the access stage names a create for a missing file", async () => {
    const { authorizer, targets } = recording(() => ({ allow: true }));
    const { write } = harness({ deps: { authorize: authorizer } });
    await write({ path: "/n.txt", content: "x" });
    expect(targets.map((target) => [target.action, target.change === null])).toEqual([
      ["create", true],
      ["create", false],
    ]);
  });

  test("the change stage sees the planned change and the whole plan", async () => {
    const { authorizer, targets } = recording(() => ({ allow: true }));
    const { read, write } = harness({
      files: { "/a.txt": "one\n" },
      deps: { authorize: authorizer },
    });
    await read({ path: "/a.txt" });
    await write({ path: "/a.txt", content: "two\n" });
    const change = targets[1];
    expect(change?.change).toMatchObject({
      tool: "write",
      kind: "update",
      before: { text: "one\n" },
      after: { text: "two\n" },
      fragments: [{ oldText: "one\n", newText: "two\n" }],
      linesAdded: 1,
      linesRemoved: 1,
    });
    expect(change?.plan).toEqual([change?.change as PlannedChange]);
    expect(change?.change?.diff).toContain("-one\n+two\n");
  });

  test("a change-stage denial with a host note keeps its message, and nothing is written", async () => {
    const { authorizer } = recording((target) =>
      target.change === null
        ? { allow: true }
        : { allow: false, note: { code: "policy", severity: "warning", message: "Not today." } },
    );
    const { fs, write } = harness({ deps: { authorize: authorizer } });
    const result = await write({ path: "/n.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "DENIED",
      phase: "authorize",
      data: { source: "policy" },
    });
    expect(result.notes).toEqual([
      { code: "denied", severity: "warning", message: "Not today.", data: { source: "policy" } },
    ]);
    expect(text(fs, "/n.txt")).toBeNull();
  });

  test("allow notes from both stages are kept in order", async () => {
    const { authorizer } = recording((target) => ({
      allow: true,
      notes: [
        { code: target.change === null ? "access" : "change", severity: "info", message: "ok" },
      ],
    }));
    const { write } = harness({ deps: { authorize: authorizer } });
    expect(codes(await write({ path: "/n.txt", content: "x" }))).toEqual(["access", "change"]);
  });

  test("a read ToolAuthorizer (denyPaths) works in both stages", async () => {
    const { write } = harness({ deps: { authorize: denyPaths(["**/.env"]) } });
    expect(errorCode(await write({ path: "/app/.env", content: "x" }))).toBe("DENIED");
    expect((await write({ path: "/app/ok.txt", content: "x" })).status).toBe("ok");
  });

  test("W6: content replaces the planned text, is re-diffed, and is marked user-modified", async () => {
    const { authorizer } = recording((target) =>
      target.change === null ? { allow: true } : { allow: true, content: "theirs\r\n" },
    );
    const { fs, read, write } = harness({
      files: { "/a.txt": "one\r\n" },
      deps: { authorize: authorizer },
    });
    await read({ path: "/a.txt" });
    const result = await write({ path: "/a.txt", content: "mine\n" });
    expect(result.status).toBe("ok");
    expect(text(fs, "/a.txt")).toBe("theirs\r\n");
    const [change] = result.changes;
    expect(change?.userModified).toBe(true);
    expect(change?.diff).toContain("+theirs\n");
    expect(note(result, "user-modified")?.message).toContain("/a.txt");
  });

  test("W6: the guards run again on the new content", async () => {
    const seen: string[] = [];
    const guard: Guard<unknown> = {
      id: "no-secrets",
      check: (change) => {
        seen.push(change.after?.text ?? "");
        return change.after?.text.includes("secret")
          ? { allow: false, note: { code: "secret", severity: "warning", message: "No secrets." } }
          : { allow: true };
      },
    };
    const { authorizer } = recording((target) =>
      target.change === null ? { allow: true } : { allow: true, content: "a secret" },
    );
    const { fs, write } = harness({ deps: { authorize: authorizer, guards: [guard] } });
    const result = await write({ path: "/n.txt", content: "plain" });
    expect(seen).toEqual(["plain", "a secret"]);
    expect(errorOf(result)).toMatchObject({ code: "GUARD_REFUSED", phase: "guards" });
    expect(text(fs, "/n.txt")).toBeNull();
  });

  test("W6: content equal to the file is no-change", async () => {
    const { authorizer } = recording((target) =>
      target.change === null ? { allow: true } : { allow: true, content: "one\n" },
    );
    const { read, write } = harness({
      files: { "/a.txt": "one\n" },
      deps: { authorize: authorizer },
    });
    await read({ path: "/a.txt" });
    expect((await write({ path: "/a.txt", content: "two\n" })).status).toBe("no-change");
  });

  test("W6 on edit: content is re-diffed and re-snippeted", async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `l${index + 1}`);
    const { authorizer } = recording((target) =>
      target.change === null
        ? { allow: true }
        : { allow: true, content: `${lines.join("\n").replace("l17", "user")}\n` },
    );
    const { fs, read, edit } = harness({
      files: { "/a.txt": `${lines.join("\n")}\n` },
      deps: { authorize: authorizer, limits: { snippetLines: 1 } },
    });
    await read({ path: "/a.txt" });
    const result = await edit({ path: "/a.txt", edits: [{ oldText: "l2\n", newText: "two\n" }] });
    expect(text(fs, "/a.txt")).toContain("\nl2\n");
    expect(text(fs, "/a.txt")).toContain("\nuser\n");
    const [change] = result.changes;
    expect(change?.userModified).toBe(true);
    expect(change?.snippets).toEqual([{ startLine: 16, lines: ["l16", "user", "l18"] }]);
    expect(codes(result)).toEqual(["user-modified"]);
  });

  test("W6 on edit: content equal to the file is NO_CHANGE", async () => {
    const { authorizer } = recording((target) =>
      target.change === null ? { allow: true } : { allow: true, content: "one\n" },
    );
    const { read, edit } = harness({
      files: { "/a.txt": "one\n" },
      deps: { authorize: authorizer },
    });
    await read({ path: "/a.txt" });
    const result = await edit({ path: "/a.txt", edits: [{ oldText: "one", newText: "two" }] });
    expect(errorOf(result)).toMatchObject({ code: "NO_CHANGE", phase: "encode" });
  });

  test("content in the access stage is EXTENSION_FAILED", async () => {
    const { authorizer } = recording(() => ({ allow: true, content: "x" }));
    const { write } = harness({ deps: { authorize: authorizer } });
    const result = await write({ path: "/n.txt", content: "y" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "EXTENSION_FAILED",
      phase: "authorize",
      data: { extension: "authorize", phase: "authorize", id: "recording" },
    });
  });

  test.each([
    [
      "a throw",
      () => {
        throw new Error("boom");
      },
    ],
    ["a malformed decision", () => ({ allow: "yes" })],
    ["a malformed note", () => ({ allow: false, note: { code: 1 } })],
    ["non-string content", () => ({ allow: true, content: 1 })],
  ])("%s is EXTENSION_FAILED", async (_name, decide) => {
    const { write } = harness({
      deps: { authorize: { id: "bad", authorize: decide as never } },
    });
    const result = await write({ path: "/n.txt", content: "y" });
    expect(errorOf(result)?.code).toBe("EXTENSION_FAILED");
    expect(errorOf(result)?.data).toMatchObject({ extension: "authorize", id: "bad" });
  });
});
