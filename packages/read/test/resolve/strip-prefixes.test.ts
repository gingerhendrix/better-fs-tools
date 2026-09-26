import { describe, expect, test } from "bun:test";

import { stripPrefixes } from "../../src/index.ts";
import { resolveContext } from "./context.ts";

describe("stripPrefixes", () => {
  const ctx = resolveContext();
  const path = async (resolver: ReturnType<typeof stripPrefixes>, input: string) => {
    const outcome = await resolver.resolve(input, ctx);
    return outcome.kind === "path" ? outcome.path : null;
  };

  test("strips a file URL and percent-decodes it", async () => {
    const resolver = stripPrefixes();
    expect(await path(resolver, "file:///srv/a%20b.txt")).toBe("/srv/a b.txt");
    expect(await path(resolver, "file://localhost/srv/a.txt")).toBe("/srv/a.txt");
  });

  test("strips a leading @", async () => {
    const resolver = stripPrefixes();
    expect(await path(resolver, "@src/a.ts")).toBe("src/a.ts");
    expect(await path(resolver, "@")).toBe("@");
    expect(await path(resolver, "src/@a.ts")).toBe("src/@a.ts");
  });

  test("leaves a URL that does not decode to a usable path unchanged", async () => {
    const resolver = stripPrefixes();
    for (const input of ["file://%E0%A4%A", "file://", "file:///a%00b"]) {
      expect(await path(resolver, input)).toBe(input);
    }
  });

  test("each strip can be turned off", async () => {
    expect(await path(stripPrefixes({ fileUrl: false }), "file:///a.txt")).toBe("file:///a.txt");
    expect(await path(stripPrefixes({ at: false }), "@a.txt")).toBe("@a.txt");
  });
});
