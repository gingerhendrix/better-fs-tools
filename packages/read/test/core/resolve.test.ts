import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { ListOutcome } from "@better-fs-tools/fs";

import { createReadTool, textOf } from "../../src/index.ts";
import type {
  PathResolver,
  ReadContext,
  ReadNote,
  ResolveContext,
  ResolveOutcome,
} from "../../src/index.ts";
import { expectFailure, expectOk, spyFileSystem } from "../helpers.ts";

interface Host {
  readonly id: string;
}

const NOTE: ReadNote = { code: "moved", severity: "info", message: "moved" };

function resolver(
  resolve: (path: string, ctx: ResolveContext<unknown>) => ResolveOutcome | Promise<ResolveOutcome>,
): PathResolver<unknown> {
  return { id: "test", resolve };
}

function files() {
  return spyFileSystem(memoryFileSystem({ files: { "/src/a.ts": "one\n", "/src/b.ts": "two\n" } }));
}

describe("resolve stage", () => {
  test("with no resolver the requested path goes into the one open", async () => {
    const { fs, opens } = files();
    const result = expectOk(await createReadTool({ fs })({ path: "/src/a.ts" }));
    expect(opens).toEqual(["/src/a.ts"]);
    expect(result.file.resolvedFrom).toBeNull();
  });

  test("a changed path is opened once, with resolvedFrom and the note last", async () => {
    const { fs, opens } = files();
    const read = createReadTool({
      fs,
      resolve: resolver(() => ({ kind: "path", path: "/src/b.ts", note: NOTE })),
    });
    const result = expectOk(await read({ path: "b" }));
    expect(opens).toEqual(["/src/b.ts"]);
    expect(result.request.path).toBe("b");
    expect(result.file).toMatchObject({
      requestedPath: "b",
      resolvedPath: "/src/b.ts",
      resolvedFrom: "b",
    });
    expect(result.notes.at(-1)).toEqual(NOTE);
    expect(textOf(result)).toContain("[read:moved] moved");
  });

  test("an unchanged path leaves resolvedFrom null", async () => {
    const { fs } = files();
    const read = createReadTool({ fs, resolve: resolver((path) => ({ kind: "path", path })) });
    expect(expectOk(await read({ path: "/src/a.ts" })).file.resolvedFrom).toBeNull();
  });

  test("the resolver note stays on a refusal after open", async () => {
    const { fs } = files();
    const read = createReadTool({
      fs,
      resolve: resolver(() => ({ kind: "path", path: "/src", note: NOTE })),
    });
    const result = expectFailure(await read({ path: "x" }), "NOT_A_FILE");
    expect(result.notes.map((note) => note.code)).toEqual(["not-a-file", "moved"]);
  });

  test("not-found gives NOT_FOUND with suggestions, and nothing is opened", async () => {
    const { fs, opens, lists } = files();
    const read = createReadTool({
      fs,
      resolve: resolver(() => ({ kind: "not-found", note: NOTE })),
    });
    const result = expectFailure(await read({ path: "/src/a.tsx" }), "NOT_FOUND");
    expect(opens).toEqual([]);
    expect(lists).toEqual(["/src"]);
    expect(result.notes[0]?.data).toEqual({ suggestions: ["a.ts", "b.ts"] });
    expect(result.notes.at(-1)).toEqual(NOTE);
  });

  test("ctx.list gives one listing; a second call in the same read fails", async () => {
    const { fs, lists } = files();
    const outcomes: ListOutcome[] = [];
    const read = createReadTool({
      fs,
      resolve: resolver(async (path, ctx) => {
        outcomes.push(await ctx.list("/src"));
        outcomes.push(await ctx.list("/src"));
        return { kind: "path", path };
      }),
    });
    expectOk(await read({ path: "/src/a.ts" }));
    expect(lists).toEqual(["/src"]);
    expect(outcomes[0]?.ok).toBe(true);
    expect(outcomes[1]).toEqual({
      ok: false,
      error: { reason: "denied", detail: "listing budget spent" },
    });

    // The budget is for each read, not for the tool.
    expectOk(await read({ path: "/src/a.ts" }));
    expect(lists).toEqual(["/src", "/src"]);
  });

  test("a read lists at most twice: once for the resolver, once for suggestions", async () => {
    const { fs, lists } = files();
    const read = createReadTool({
      fs,
      resolve: resolver(async (path, ctx) => {
        await ctx.list("/src");
        return { kind: "path", path };
      }),
    });
    expectFailure(await read({ path: "/src/c.ts" }), "NOT_FOUND");
    expect(lists).toEqual(["/src", "/src"]);
  });

  test("ctx.list on a backend with no list() is an error outcome", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "x\n" }, list: false });
    let listed: ListOutcome | undefined;
    const read = createReadTool({
      fs,
      resolve: resolver(async (path, ctx) => {
        listed = await ctx.list("/");
        return { kind: "path", path };
      }),
    });
    expectOk(await read({ path: "/a.txt" }));
    expect(listed).toEqual({
      ok: false,
      error: { reason: "unsupported", detail: "the backend cannot list" },
    });
  });

  test("a throwing resolver gives EXTENSION_FAILED in the resolve phase", async () => {
    const { fs, opens } = files();
    const read = createReadTool({
      fs,
      resolve: resolver(() => {
        throw new Error("secret detail");
      }),
    });
    const result = expectFailure(await read({ path: "/src/a.ts" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({ extension: "resolve", phase: "resolve" });
    expect(textOf(result)).not.toContain("secret detail");
    expect(opens).toEqual([]);
  });

  test("a malformed outcome gives EXTENSION_FAILED", async () => {
    const { fs } = files();
    for (const outcome of [
      null,
      { kind: "other" },
      { kind: "path" },
      { kind: "path", path: " " },
      { kind: "path", path: "a\0b" },
      { kind: "path", path: "/src/a.ts", note: { code: "x" } },
    ]) {
      const read = createReadTool({ fs, resolve: resolver(() => outcome as never) });
      expectFailure(await read({ path: "/src/a.ts" }), "EXTENSION_FAILED");
    }
  });

  test("an abort during the resolver gives ABORTED in the resolve phase", async () => {
    const { fs, opens } = files();
    const controller = new AbortController();
    const read = createReadTool({
      fs,
      resolve: resolver((path) => {
        controller.abort();
        return { kind: "path", path };
      }),
    });
    const result = expectFailure(
      await read({ path: "/src/a.ts" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "resolve" });
    expect(opens).toEqual([]);
  });

  test("the resolver gets the caller's call object and the hook context", async () => {
    const { fs } = files();
    const seen: ResolveContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs,
      resolve: {
        id: "spy",
        resolve(path, ctx) {
          seen.push(ctx);
          return { kind: "path", path };
        },
      },
    });
    const call: ReadContext<Host> = { host: { id: "h1" }, callId: "c1" };
    expectOk(await read({ path: "/src/a.ts", limit: 3 }, call));
    const ctx = seen[0];
    expect(ctx?.call).toBe(call);
    expect(ctx?.request).toEqual({ path: "/src/a.ts", offset: 1, limit: 3, ranged: true });
    expect(ctx?.paths).toBe(fs.paths);
    expect(ctx?.limits.maxDirectoryEntries).toBe(200);
    expect(typeof ctx?.messages.pathRepaired).toBe("function");
  });
});
