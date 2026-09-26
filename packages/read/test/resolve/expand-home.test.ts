import { describe, expect, test } from "bun:test";

import { expandHome } from "../../src/index.ts";
import { resolveContext } from "./context.ts";

describe("expandHome", () => {
  const resolver = expandHome({ home: "/home/me" });
  const ctx = resolveContext();

  test("expands ~ and ~/x", async () => {
    expect(await resolver.resolve("~", ctx)).toEqual({ kind: "path", path: "/home/me" });
    expect(await resolver.resolve("~/", ctx)).toEqual({ kind: "path", path: "/home/me" });
    expect(await resolver.resolve("~/a/b.txt", ctx)).toEqual({
      kind: "path",
      path: "/home/me/a/b.txt",
    });
  });

  test("passes ~user and other paths through unchanged", async () => {
    for (const path of ["~bob/a.txt", "a/~/b", "/abs/~", "src/a.ts"]) {
      expect(await resolver.resolve(path, ctx)).toEqual({ kind: "path", path });
    }
  });

  test("needs a non-empty home", () => {
    expect(() => expandHome({ home: "" })).toThrow(TypeError);
    expect(() => expandHome({} as never)).toThrow(TypeError);
  });
});
