import { describe, expect, spyOn, test } from "bun:test";

import { expandHome, unicodeRepair } from "@better-fs-tools/read";

import type { WriteToolDeps } from "../../src/index.ts";
import { errorOf, codes, errorCode, harness, text } from "../helpers.ts";

type Resolver = NonNullable<WriteToolDeps["resolve"]>;

describe("resolve", () => {
  test("the read tool's resolvers work unchanged", async () => {
    const { fs, write } = harness({
      fsOptions: { directories: ["/home/me"] },
      deps: { resolve: expandHome({ home: "/home/me" }) },
    });
    const result = await write({ path: "~/notes.md", content: "x" });
    expect(result.status).toBe("ok");
    expect(result.changes[0]?.requestedPath).toBe("~/notes.md");
    expect(text(fs, "/home/me/notes.md")).toBe("x");
  });

  test("unicodeRepair uses its one listing and adds its note", async () => {
    const { fs, read, write } = harness({
      files: { "/docs/café.md": "old\n" },
      deps: { resolve: unicodeRepair() },
    });
    await read({ path: "/docs/café.md" });
    const result = await write({ path: "/docs/café.md", content: "new\n" });
    expect(result.status).toBe("ok");
    expect(codes(result)).toContain("path-repaired");
    expect(text(fs, "/docs/café.md")).toBe("new\n");
  });

  test("a second listing in one call gets an error outcome", async () => {
    const outcomes: boolean[] = [];
    const resolver: Resolver = {
      id: "greedy",
      resolve: async (path, ctx) => {
        outcomes.push((await ctx.list("/")).ok, (await ctx.list("/")).ok);
        return { kind: "path", path };
      },
    };
    const { write } = harness({ deps: { resolve: resolver } });
    await write({ path: "/a.txt", content: "x" });
    expect(outcomes).toEqual([true, false]);
  });

  test("not-found is NOT_FOUND with the resolver's note", async () => {
    const resolver: Resolver = {
      id: "nope",
      resolve: () => ({
        kind: "not-found",
        note: { code: "why", severity: "info", message: "No such alias." },
      }),
    };
    const { write } = harness({ deps: { resolve: resolver } });
    const result = await write({ path: "@alias", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "NOT_FOUND",
      phase: "resolve",
    });
    expect(codes(result)).toEqual(["not-found", "why"]);
  });

  test.each([
    [
      "a throw",
      () => {
        throw new Error("boom");
      },
    ],
    ["a blank path", () => ({ kind: "path", path: " " })],
    ["an unknown kind", () => ({ kind: "maybe" })],
  ])("%s is EXTENSION_FAILED", async (_name, resolve) => {
    const { write } = harness({ deps: { resolve: { id: "bad", resolve: resolve as never } } });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "EXTENSION_FAILED",
      phase: "resolve",
      data: { extension: "resolve", phase: "resolve", id: "bad" },
    });
  });
});

describe("stat", () => {
  test("a directory target is NOT_A_FILE", async () => {
    const { write } = harness({ fsOptions: { directories: ["/dir"] } });
    const result = await write({ path: "/dir", content: "x" });
    expect(errorOf(result)).toEqual({
      message: expect.any(String),
      code: "NOT_A_FILE",
      phase: "stat",
      data: { kind: "directory" },
    });
  });

  test("a deny root is DANGEROUS_PATH at stat", async () => {
    const { write } = harness({ fsOptions: { denyRoots: ["/secret"] } });
    const result = await write({ path: "/secret/a.txt", content: "x" });
    expect(errorOf(result)?.code).toBe("DANGEROUS_PATH");
    expect(errorOf(result)?.phase).toBe("stat");
  });

  test("a parent that is a file is NOT_FOUND", async () => {
    const { write } = harness({ files: { "/a": "file" } });
    expect(errorCode(await write({ path: "/a/b.txt", content: "x" }))).toBe("NOT_FOUND");
  });

  test("a real path that changes between the two stats is STALE", async () => {
    const { fs, write } = harness({ deps: { preconditions: { requireRead: "off" } } });
    let calls = 0;
    const stat = fs.stat.bind(fs);
    spyOn(fs, "stat").mockImplementation(async (path, options) => {
      calls += 1;
      const outcome = await stat(path, options);
      if (calls !== 2 || !outcome.ok) return outcome;
      return { ok: true, stat: { ...outcome.stat, resolvedPath: "/elsewhere.txt" } };
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(errorOf(result)).toEqual({ message: expect.any(String), code: "STALE", phase: "stat" });
  });

  test("a file that appears between the two stats is judged by the second", async () => {
    const { fs, write } = harness({ deps: { preconditions: { requireRead: "off" } } });
    const stat = fs.stat.bind(fs);
    let calls = 0;
    spyOn(fs, "stat").mockImplementation(async (path, options) => {
      calls += 1;
      if (calls === 2) fs.setFile("/a.txt", "appeared\n");
      return stat(path, options);
    });
    const result = await write({ path: "/a.txt", content: "x" });
    expect(result.status).toBe("ok");
    expect(result.changes[0]?.kind).toBe("update");
    expect(text(fs, "/a.txt")).toBe("x");
  });

  test("a throwing or malformed stat is IO_ERROR", async () => {
    for (const bad of [
      async () => {
        throw new Error("stat failed");
      },
      async () => ({ ok: true, stat: { exists: true } }),
    ]) {
      const { fs, write } = harness();
      spyOn(fs, "stat").mockImplementation(bad as never);
      expect(errorCode(await write({ path: "/a.txt", content: "x" }))).toBe("IO_ERROR");
    }
  });
});
