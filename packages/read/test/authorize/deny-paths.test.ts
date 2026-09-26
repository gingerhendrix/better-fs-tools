import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, denyPaths, textOf } from "../../src/index.ts";
import { expectFailure, expectOk } from "../helpers.ts";
import { hookContext, listTarget, readTarget } from "./context.ts";

async function allows(patterns: readonly string[], path: string): Promise<boolean> {
  return (await denyPaths(patterns).authorize(readTarget(path), hookContext())).allow;
}

describe("denyPaths", () => {
  test("** matches zero or more whole segments", async () => {
    expect(await allows(["**/.env"], "/.env")).toBe(false);
    expect(await allows(["**/.env"], "/srv/app/.env")).toBe(false);
    expect(await allows(["**/.env"], ".env")).toBe(false);
    expect(await allows(["**/.env"], "/srv/app/.env.local")).toBe(true);
    expect(await allows(["**/.env"], "/srv/app/x.env")).toBe(true);
    expect(await allows(["/etc/**"], "/etc")).toBe(false);
    expect(await allows(["/etc/**"], "/etc/ssh/sshd_config")).toBe(false);
    expect(await allows(["/etc/**"], "/srv/etc/a")).toBe(true);
    expect(await allows(["/srv/**/secrets/*"], "/srv/secrets/a")).toBe(false);
    expect(await allows(["/srv/**/secrets/*"], "/srv/a/b/secrets/a")).toBe(false);
    expect(await allows(["/srv/**/secrets/*"], "/srv/a/b/secrets")).toBe(true);
  });

  test("* stays inside one segment, ? is one character, and dot names match", async () => {
    expect(await allows(["**/.env.*"], "/srv/.env.local")).toBe(false);
    expect(await allows(["/srv/*"], "/srv/.hidden")).toBe(false);
    expect(await allows(["/srv/*"], "/srv/a/b")).toBe(true);
    expect(await allows(["/srv/*.pem"], "/srv/key.pem")).toBe(false);
    expect(await allows(["/srv/?.txt"], "/srv/a.txt")).toBe(false);
    expect(await allows(["/srv/?.txt"], "/srv/ab.txt")).toBe(true);
  });

  test("other characters match themselves", async () => {
    expect(await allows(["/srv/a+b (1).txt"], "/srv/a+b (1).txt")).toBe(false);
    expect(await allows(["/srv/a.txt"], "/srv/aXtxt")).toBe(true);
    expect(await allows(["/srv/[ab].txt"], "/srv/a.txt")).toBe(true);
    expect(await allows(["/srv/[ab].txt"], "/srv/[ab].txt")).toBe(false);
  });

  test("denies a list of a matching directory", async () => {
    const authorizer = denyPaths(["**/secrets", "**/secrets/**"]);
    expect((await authorizer.authorize(listTarget("/srv/secrets"), hookContext())).allow).toBe(
      false,
    );
    expect((await authorizer.authorize(listTarget("/srv/public"), hookContext())).allow).toBe(true);
  });

  test("the denial note uses the catalog's denied text and names the pattern", async () => {
    const decision = await denyPaths(["/a", "**/.env"]).authorize(
      readTarget("/srv/.env"),
      hookContext({ path: "config" }),
    );
    expect(decision).toEqual({
      allow: false,
      note: {
        code: "denied",
        severity: "warning",
        message: "config was refused by policy (the path matches a denied pattern).",
        data: { pattern: "**/.env" },
      },
    });
  });

  test("denies through createReadTool, and allows other files", async () => {
    const fs = memoryFileSystem({ files: { "/srv/.env": "KEY=1\n", "/srv/a.txt": "a\n" } });
    const read = createReadTool({ fs, authorize: denyPaths(["**/.env"]) });
    const denied = expectFailure(await read({ path: "/srv/.env" }), "DENIED");
    expect(textOf(denied)).not.toContain("KEY");
    expectOk(await read({ path: "/srv/a.txt" }));
  });

  test("has a stable id and refuses bad patterns", () => {
    expect(denyPaths([]).id).toBe("deny-paths");
    expect(() => denyPaths("**/.env" as never)).toThrow(TypeError);
    expect(() => denyPaths([""])).toThrow(TypeError);
    expect(() => denyPaths([1] as never)).toThrow(TypeError);
  });
});
