import { describe, expect, test } from "bun:test";

import { denyPaths } from "@better-fs-tools/read";

import { writeAuthorizers } from "../../src/index.ts";
import type { WriteAuthorizer, WriteAuthorizeTarget, WriteHookContext } from "../../src/index.ts";
import { errorOf, errorCode, harness, text } from "../helpers.ts";

const target: WriteAuthorizeTarget = {
  action: "create",
  tool: "write",
  requestedPath: "a.txt",
  resolvedPath: "/a.txt",
  displayPath: "/a.txt",
  change: null,
  plan: [],
};
const ctx = {} as WriteHookContext<unknown>;

const allow = (id: string, extra: object = {}): WriteAuthorizer<unknown> => ({
  id,
  authorize: () => ({ allow: true, ...extra }),
});

describe("writeAuthorizers", () => {
  test("no steps allows", async () => {
    const chain = writeAuthorizers();
    expect(chain.id).toBe("allow");
    expect(await chain.authorize(target, ctx)).toEqual({ allow: true });
  });

  test("first deny wins; allow notes are kept in order", async () => {
    let ranAfterDeny = false;
    const chain = writeAuthorizers(
      allow("a", { notes: [{ code: "a", severity: "info", message: "a" }] }),
      allow("b", { notes: [{ code: "b", severity: "info", message: "b" }] }),
    );
    expect(await chain.authorize(target, ctx)).toEqual({
      allow: true,
      notes: [
        { code: "a", severity: "info", message: "a" },
        { code: "b", severity: "info", message: "b" },
      ],
    });
    const denying = writeAuthorizers(
      { id: "no", authorize: () => ({ allow: false }) },
      {
        id: "after",
        authorize: () => {
          ranAfterDeny = true;
          return { allow: true };
        },
      },
    );
    expect(await denying.authorize(target, ctx)).toEqual({ allow: false });
    expect(ranAfterDeny).toBe(false);
  });

  test("the first content wins and later steps see the original target", async () => {
    const seen: WriteAuthorizeTarget[] = [];
    const spy: WriteAuthorizer<unknown> = {
      id: "spy",
      authorize: (given) => {
        seen.push(given);
        return { allow: true, content: "second" };
      },
    };
    const chain = writeAuthorizers(allow("first", { content: "first" }), spy);
    expect(await chain.authorize(target, ctx)).toEqual({ allow: true, content: "first" });
    expect(seen).toEqual([target]);
  });

  test("a throwing or malformed step is named in EXTENSION_FAILED", async () => {
    for (const bad of [
      {
        id: "thrower",
        authorize: () => {
          throw new Error("boom");
        },
      },
      { id: "thrower", authorize: () => "yes" },
    ]) {
      const { write } = harness({
        deps: { authorize: writeAuthorizers(allow("ok"), bad as never) },
      });
      const result = await write({ path: "/a.txt", content: "x" });
      expect(errorOf(result)?.data).toEqual({
        extension: "authorize",
        phase: "authorize",
        id: "thrower",
      });
    }
  });

  test("takes a read ToolAuthorizer as a step", async () => {
    const { fs, write } = harness({
      deps: { authorize: writeAuthorizers(denyPaths(["**/*.lock"]), allow("rest")) },
    });
    expect(errorCode(await write({ path: "/bun.lock", content: "x" }))).toBe("DENIED");
    expect(text(fs, "/bun.lock")).toBeNull();
  });

  test("rejects a non-authorizer", () => {
    expect(() => writeAuthorizers({} as never)).toThrow(TypeError);
  });
});
