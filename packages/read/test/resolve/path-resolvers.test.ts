import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, expandHome, pathResolvers, stripPrefixes } from "../../src/index.ts";
import type { PathResolver, ReadNote } from "../../src/index.ts";
import { expectFailure } from "../helpers.ts";
import { resolveContext } from "./context.ts";

const note = (code: string): ReadNote => ({ code, severity: "info", message: code });

describe("pathResolvers", () => {
  test("runs left to right, each step on the previous path", async () => {
    const resolver = pathResolvers(stripPrefixes(), expandHome({ home: "/home/me" }));
    expect(resolver.id).toBe("strip-prefixes+expand-home");
    expect(await resolver.resolve("@~/a.txt", resolveContext())).toEqual({
      kind: "path",
      path: "/home/me/a.txt",
    });
  });

  test("the first not-found stops, and the last note wins", async () => {
    const seen: string[] = [];
    const step = (id: string, outcome: "path" | "not-found"): PathResolver<unknown> => ({
      id,
      resolve(path) {
        seen.push(id);
        return outcome === "path"
          ? { kind: "path", path: `${path}/${id}`, note: note(id) }
          : { kind: "not-found" };
      },
    });
    const resolver = pathResolvers(step("a", "path"), step("b", "not-found"), step("c", "path"));
    expect(await resolver.resolve("x", resolveContext())).toEqual({
      kind: "not-found",
      note: note("a"),
    });
    expect(seen).toEqual(["a", "b"]);

    const both = pathResolvers(step("a", "path"), step("c", "path"));
    expect(await both.resolve("x", resolveContext())).toEqual({
      kind: "path",
      path: "x/a/c",
      note: note("c"),
    });
  });

  test("steps share the one ctx", async () => {
    const lists: string[] = [];
    const ctx = resolveContext([], lists);
    const lister: PathResolver<unknown> = {
      id: "lister",
      async resolve(path, stepCtx) {
        expect(stepCtx).toBe(ctx);
        await stepCtx.list("/");
        return { kind: "path", path };
      },
    };
    await pathResolvers(lister, lister).resolve("a", ctx);
    expect(lists).toEqual(["/", "/"]);
  });

  test("no steps is identity; a non-resolver throws", async () => {
    expect(await pathResolvers().resolve("a", resolveContext())).toEqual({
      kind: "path",
      path: "a",
    });
    expect(() => pathResolvers({} as never)).toThrow(TypeError);
  });

  test("EXTENSION_FAILED names the step that threw, also inside a nested chain", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "a\n" } });
    const boom: PathResolver<unknown> = {
      id: "boom",
      resolve() {
        throw new Error("secret detail");
      },
    };
    const broken: PathResolver<unknown> = { id: "broken", resolve: () => null as never };
    for (const [resolve, id] of [
      [pathResolvers(stripPrefixes(), boom), "boom"],
      [pathResolvers(stripPrefixes(), pathResolvers(expandHome({ home: "/" }), boom)), "boom"],
      [pathResolvers(broken, stripPrefixes()), "broken"],
    ] as const) {
      const result = await createReadTool({ fs, resolve })({ path: "/a.txt" });
      expect(expectFailure(result, "EXTENSION_FAILED").notes[0]?.data).toEqual({
        extension: "resolve",
        phase: "resolve",
        id,
      });
    }
  });
});
