import { describe, expect, test } from "bun:test";

import { containsPosix, posixPaths, resolvePosix } from "../src/index.ts";

describe("posixPaths", () => {
  test("dirname handles roots, relative names, and trailing slashes", () => {
    expect(posixPaths.dirname("/a/b.txt")).toBe("/a");
    expect(posixPaths.dirname("/a.txt")).toBe("/");
    expect(posixPaths.dirname("a.txt")).toBe(".");
    expect(posixPaths.dirname("/a/b/")).toBe("/a");
    expect(posixPaths.dirname("/")).toBe("/");
  });

  test("basename returns the last segment", () => {
    expect(posixPaths.basename("/a/b.txt")).toBe("b.txt");
    expect(posixPaths.basename("b.txt")).toBe("b.txt");
    expect(posixPaths.basename("/a/b/")).toBe("b");
  });

  test("join adds one separator and keeps absolute names", () => {
    expect(posixPaths.join("/a", "b.txt")).toBe("/a/b.txt");
    expect(posixPaths.join("/a/", "b.txt")).toBe("/a/b.txt");
    expect(posixPaths.join(".", "b.txt")).toBe("b.txt");
    expect(posixPaths.join("", "b.txt")).toBe("b.txt");
    expect(posixPaths.join("/a", "/b.txt")).toBe("/b.txt");
  });

  test("has no style field", () => {
    expect(Object.keys(posixPaths).sort()).toEqual(["basename", "dirname", "join"]);
  });
});

describe("resolvePosix", () => {
  test("resolves relative values against the base", () => {
    expect(resolvePosix("/work", "src/a.ts")).toBe("/work/src/a.ts");
    expect(resolvePosix("/work", "./src/../b.ts")).toBe("/work/b.ts");
  });

  test("keeps absolute values and collapses dot segments", () => {
    expect(resolvePosix("/work", "/etc//x/./y")).toBe("/etc/x/y");
    expect(resolvePosix("/", "../../x")).toBe("/x");
  });
});

describe("containsPosix", () => {
  test("accepts the root itself and paths beneath it", () => {
    expect(containsPosix("/work", "/work")).toBe(true);
    expect(containsPosix("/work", "/work/a.ts")).toBe(true);
    expect(containsPosix("/work/", "/work/a.ts")).toBe(true);
    expect(containsPosix("/", "/anything")).toBe(true);
  });

  test("rejects siblings that share a prefix", () => {
    expect(containsPosix("/work", "/workshop/a.ts")).toBe(false);
    expect(containsPosix("/work", "/")).toBe(false);
  });
});
