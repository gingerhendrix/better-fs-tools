import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";

import {
  askUser,
  createReadTool,
  denyPaths,
  readAuthorizers,
  sizeCeiling,
} from "../../src/index.ts";
import type {
  ReadAuthorizeDecision,
  ReadAuthorizer,
  ReadContext,
  ReadNote,
} from "../../src/index.ts";
import { expectFailure, expectOk } from "../helpers.ts";
import { hookContext, readTarget } from "./context.ts";

const note = (code: string): ReadNote => ({ code, severity: "info", message: code });

function step(
  id: string,
  decision: ReadAuthorizeDecision,
  seen: string[],
): ReadAuthorizer<unknown> {
  return {
    id,
    authorize() {
      seen.push(id);
      return decision;
    },
  };
}

describe("authorizers", () => {
  test("first deny wins, and later steps do not run", async () => {
    const seen: string[] = [];
    const chain = readAuthorizers(
      step("a", { allow: true, notes: [note("a")] }, seen),
      step("b", { allow: false, note: note("b") }, seen),
      step("c", { allow: false, note: note("c") }, seen),
    );
    expect(chain.id).toBe("a+b+c");
    expect(await chain.authorize(readTarget("/x"), hookContext())).toEqual({
      allow: false,
      note: note("b"),
    });
    expect(seen).toEqual(["a", "b"]);
  });

  test("allow notes from every step are kept, in order", async () => {
    const seen: string[] = [];
    const chain = readAuthorizers(
      step("a", { allow: true, notes: [note("a1"), note("a2")] }, seen),
      step("b", { allow: true }, seen),
      step("c", { allow: true, notes: [note("c")] }, seen),
    );
    expect(await chain.authorize(readTarget("/x"), hookContext())).toEqual({
      allow: true,
      notes: [note("a1"), note("a2"), note("c")],
    });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  test("no steps allows; a non-authorizer throws", async () => {
    const empty = readAuthorizers();
    expect(empty.id).toBe("allow");
    expect(await empty.authorize(readTarget("/x"), hookContext())).toEqual({ allow: true });
    expect(() => readAuthorizers({} as never)).toThrow(TypeError);
  });

  test("the built-in helpers compose through createReadTool", async () => {
    const fs = memoryFileSystem({
      files: { "/srv/.env": "KEY=1\n", "/srv/big.txt": "x\n".repeat(50), "/srv/a.txt": "a\n" },
    });
    const asked: string[] = [];
    const read = createReadTool({
      fs,
      authorize: readAuthorizers(
        denyPaths(["**/.env"]),
        sizeCeiling({ maxBytes: 10, unrangedOnly: true }),
        askUser(async (target) => {
          asked.push(target.resolvedPath);
          return true;
        }),
      ),
    });
    expectFailure(await read({ path: "/srv/.env" }), "DENIED");
    expectFailure(await read({ path: "/srv/big.txt" }), "DENIED");
    expectOk(await read({ path: "/srv/big.txt", limit: 2 }));
    expectOk(await read({ path: "/srv/a.txt" }));
    expect(asked).toEqual(["/srv/big.txt", "/srv/a.txt"]);
  });

  test("EXTENSION_FAILED names the step that threw, also inside a nested chain", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "a\n" } });
    const boom: ReadAuthorizer<unknown> = {
      id: "boom",
      authorize() {
        throw new Error("secret detail");
      },
    };
    const broken: ReadAuthorizer<unknown> = { id: "broken", authorize: () => null as never };
    for (const [authorize, id] of [
      [readAuthorizers(denyPaths([]), boom), "boom"],
      [readAuthorizers(denyPaths([]), readAuthorizers(sizeCeiling({ maxBytes: 9 }), boom)), "boom"],
      [readAuthorizers(broken, denyPaths([])), "broken"],
    ] as const) {
      const result = await createReadTool({ fs, authorize })({ path: "/a.txt" });
      expect(expectFailure(result, "EXTENSION_FAILED").notes[0]?.data).toEqual({
        extension: "authorize",
        phase: "authorize",
        id,
      });
    }
  });

  test("every step gets the same call object the caller passed", async () => {
    const call: ReadContext<{ readonly user: string }> = { host: { user: "u1" } };
    const calls: unknown[] = [];
    const record: ReadAuthorizer<{ readonly user: string }> = {
      id: "record",
      authorize(_target, ctx) {
        calls.push(ctx.call);
        return { allow: ctx.call.host.user === "u1" };
      },
    };
    const read = createReadTool<{ readonly user: string }>({
      fs: memoryFileSystem({ files: { "/a.txt": "a\n" } }),
      authorize: readAuthorizers(record, denyPaths([]), record),
    });
    expectOk(await read({ path: "/a.txt" }, call));
    expect(calls).toEqual([call, call]);
    expect(calls.every((seen) => seen === call)).toBe(true);
  });
});
