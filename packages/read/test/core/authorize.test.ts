import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { FileSystem, ListOptions, ListOutcome } from "@better-fs-tools/fs";

import { createReadTool, textOf } from "../../src/index.ts";
import type {
  ReadAuthorizeDecision,
  ReadAuthorizer,
  ReadAuthorizeTarget,
  ReadHookContext,
  ReadContext,
  ReadNote,
} from "../../src/index.ts";
import { expectFailure, expectOk } from "../helpers.ts";

interface Host {
  readonly id: string;
}

const NOTE: ReadNote = { code: "policy", severity: "info", message: "policy checked" };

function authorizer(
  authorize: (
    target: ReadAuthorizeTarget,
    ctx: ReadHookContext<unknown>,
  ) => ReadAuthorizeDecision | Promise<ReadAuthorizeDecision>,
): ReadAuthorizer<unknown> {
  return { id: "test", authorize };
}

/** Records every open, bytes(), close(), and list, in order, in one log. */
function spied(inner: FileSystem) {
  const log: string[] = [];
  const list = inner.list?.bind(inner);
  const fs: FileSystem = {
    id: inner.id,
    capabilities: inner.capabilities,
    paths: inner.paths,
    async open(path, options) {
      log.push(`open ${path}`);
      const opened = await inner.open(path, options);
      if (!opened.ok) return opened;
      const file = opened.file;
      return {
        ok: true,
        file: {
          info: file.info,
          bytes() {
            log.push("bytes");
            return file.bytes();
          },
          verify: () => file.verify(),
          async close() {
            log.push("close");
            await file.close();
          },
        },
      };
    },
    ...(list === undefined
      ? {}
      : {
          list(path: string, options: ListOptions) {
            log.push(`list ${path}`);
            return list(path, options);
          },
        }),
  };
  return { fs, log };
}

function files() {
  return spied(memoryFileSystem({ files: { "/d/a.txt": "one\ntwo\n", "/d/b.txt": "b\n" } }));
}

describe("authorize read", () => {
  test("runs after open and before any content byte, with the open target", async () => {
    const { fs, log } = files();
    const targets: ReadAuthorizeTarget[] = [];
    const read = createReadTool({
      fs,
      authorize: authorizer((target) => {
        log.push("authorize");
        targets.push(target);
        return { allow: true };
      }),
    });
    expectOk(await read({ path: "/d/a.txt", offset: 2 }));
    expect(log).toEqual(["open /d/a.txt", "authorize", "bytes", "close"]);
    expect(targets).toEqual([
      {
        action: "read",
        requestedPath: "/d/a.txt",
        resolvedPath: "/d/a.txt",
        displayPath: "/d/a.txt",
        size: 8,
        mtimeMs: null,
      },
    ]);
    expect(Object.isFrozen(targets[0])).toBe(true);
  });

  test("a denial gives DENIED, never calls bytes(), and closes the handle", async () => {
    const { fs, log } = files();
    const read = createReadTool({ fs, authorize: authorizer(() => ({ allow: false })) });
    const result = expectFailure(await read({ path: "/d/a.txt" }), "DENIED");
    expect(log).toEqual(["open /d/a.txt", "close"]);
    expect(result.file).toBeNull();
    expect(result.notes).toEqual([
      { code: "denied", severity: "warning", message: "/d/a.txt was refused by policy." },
    ]);
    expect(textOf(result)).toBe("[read:denied] /d/a.txt was refused by policy.");
  });

  test("a denial with a note gives that note", async () => {
    const { fs } = files();
    const note: ReadNote = { code: "no-secrets", severity: "warning", message: "Not this file." };
    const read = createReadTool({ fs, authorize: authorizer(() => ({ allow: false, note })) });
    expect(expectFailure(await read({ path: "/d/a.txt" }), "DENIED").notes).toEqual([note]);
  });

  test("allow notes are kept, before the resolver note", async () => {
    const { fs } = files();
    const moved: ReadNote = { code: "moved", severity: "info", message: "moved" };
    const read = createReadTool({
      fs,
      resolve: { id: "r", resolve: () => ({ kind: "path", path: "/d/a.txt", note: moved }) },
      authorize: authorizer(() => ({ allow: true, notes: [NOTE] })),
    });
    const result = expectOk(await read({ path: "a" }));
    expect(result.notes.slice(-2)).toEqual([NOTE, moved]);
    expect(textOf(result)).toContain("[read:policy] policy checked");
  });

  test("the authorizer gets the same call object the caller passed", async () => {
    const { fs } = files();
    const call: ReadContext<Host> = { host: { id: "h1" }, callId: "c1" };
    const seen: ReadHookContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs,
      authorize: {
        id: "host",
        authorize(_target, ctx) {
          seen.push(ctx);
          return { allow: ctx.call.host.id === "h1" };
        },
      },
    });
    const result = expectOk(await read({ path: "/d/a.txt" }, call));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.call).toBe(call);
    expect(seen[0]?.request).toEqual(result.request);
    expect(JSON.stringify(result)).not.toContain("h1");
  });

  test("a throwing authorizer gives EXTENSION_FAILED with its id, and closes the handle", async () => {
    const { fs, log } = files();
    const read = createReadTool({
      fs,
      authorize: authorizer(() => {
        throw new Error("secret detail");
      }),
    });
    const result = expectFailure(await read({ path: "/d/a.txt" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({
      extension: "authorize",
      phase: "authorize",
      id: "test",
    });
    expect(textOf(result)).not.toContain("secret detail");
    expect(log).toEqual(["open /d/a.txt", "close"]);
  });

  test("a malformed decision gives EXTENSION_FAILED", async () => {
    const { fs } = files();
    for (const decision of [
      null,
      true,
      {},
      { allow: "yes" },
      { allow: true, notes: NOTE },
      { allow: true, notes: [{ code: "x" }] },
      { allow: false, note: "no" },
    ]) {
      const read = createReadTool({ fs, authorize: authorizer(() => decision as never) });
      expectFailure(await read({ path: "/d/a.txt" }), "EXTENSION_FAILED");
    }
  });

  test("a change during approval gives CHANGED_DURING_READ", async () => {
    const memory = memoryFileSystem({ files: { "/d/a.txt": "one\n" } });
    const read = createReadTool({
      fs: memory,
      authorize: authorizer(async () => {
        memory.setFile("/d/a.txt", "one\nchanged\n");
        return { allow: true };
      }),
    });
    expectFailure(await read({ path: "/d/a.txt" }), "CHANGED_DURING_READ");
  });

  test("an abort during approval gives ABORTED and closes the handle", async () => {
    const { fs, log } = files();
    const controller = new AbortController();
    const read = createReadTool({
      fs,
      // Ignores the signal and never settles: the core must not wait for it.
      authorize: authorizer(() => {
        controller.abort();
        return new Promise<never>(() => {});
      }),
    });
    const result = expectFailure(
      await read({ path: "/d/a.txt" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "authorize" });
    expect(log).toEqual(["open /d/a.txt", "close"]);
  });

  test("an authorizer that honours the signal and throws also gives ABORTED", async () => {
    const { fs } = files();
    const controller = new AbortController();
    const read = createReadTool({
      fs,
      authorize: authorizer(() => {
        controller.abort();
        throw new Error("aborted by host");
      }),
    });
    const result = await read({ path: "/d/a.txt" }, { signal: controller.signal });
    expect(expectFailure(result, "ABORTED").notes[0]?.data).toEqual({ phase: "authorize" });
  });

  test("a refused open never reaches the authorizer", async () => {
    const { fs } = files();
    const actions: string[] = [];
    const read = createReadTool({
      fs,
      suggest: null,
      authorize: authorizer((target) => {
        actions.push(target.action);
        return { allow: true };
      }),
    });
    expectFailure(await read({ path: "/d" }), "NOT_A_FILE");
    expectFailure(await read({ path: "/d/missing.txt" }), "NOT_FOUND");
    expect(actions).toEqual([]);
  });
});

describe("authorize list", () => {
  test("runs before the suggest listing, on the lexical parent", async () => {
    const { fs, log } = files();
    const targets: ReadAuthorizeTarget[] = [];
    const read = createReadTool({
      fs,
      authorize: authorizer((target) => {
        log.push(`authorize ${target.action}`);
        targets.push(target);
        return { allow: true };
      }),
    });
    const result = expectFailure(await read({ path: "/d/a.tx" }), "NOT_FOUND");
    expect(result.notes[0]?.data?.suggestions).toEqual(["a.txt", "b.txt"]);
    expect(log).toEqual(["open /d/a.tx", "authorize list", "list /d"]);
    expect(targets).toEqual([
      {
        action: "list",
        requestedPath: "/d/a.tx",
        resolvedPath: "/d",
        displayPath: "/d",
        size: null,
        mtimeMs: null,
      },
    ]);
  });

  test("a list denial gives no suggestions and no listing", async () => {
    const { fs, log } = files();
    const read = createReadTool({
      fs,
      authorize: authorizer((target) => ({ allow: target.action !== "list" })),
    });
    const result = expectFailure(await read({ path: "/d/a.tx" }), "NOT_FOUND");
    expect(result.notes).toEqual([
      { code: "not-found", severity: "warning", message: "/d/a.tx was not found." },
    ]);
    expect(log).toEqual(["open /d/a.tx"]);
  });

  test("runs before the resolver listing, and a denial reaches the resolver", async () => {
    const { fs, log } = files();
    let listed: ListOutcome | undefined;
    const read = createReadTool({
      fs,
      resolve: {
        id: "lister",
        async resolve(path, ctx) {
          listed = await ctx.list("/d");
          return { kind: "path", path };
        },
      },
      authorize: authorizer((target) => ({ allow: target.action === "read" })),
    });
    expectOk(await read({ path: "/d/a.txt" }));
    expect(listed).toEqual({
      ok: false,
      error: { reason: "denied", detail: "refused by the authorizer" },
    });
    expect(log).toEqual(["open /d/a.txt", "bytes", "close"]);
  });

  test("a spent listing budget does not ask the authorizer", async () => {
    const { fs } = files();
    const actions: string[] = [];
    const read = createReadTool({
      fs,
      resolve: {
        id: "twice",
        async resolve(path, ctx) {
          await ctx.list("/d");
          await ctx.list("/d");
          return { kind: "path", path };
        },
      },
      authorize: authorizer((target) => {
        actions.push(target.action);
        return { allow: true };
      }),
    });
    expectOk(await read({ path: "/d/a.txt" }));
    expect(actions).toEqual(["list", "read"]);
  });

  test("a throw during the resolver listing fails the read, even if the resolver swallows it", async () => {
    const { fs, log } = files();
    const read = createReadTool({
      fs,
      resolve: {
        id: "swallow",
        async resolve(path, ctx) {
          await ctx.list("/d");
          return { kind: "path", path };
        },
      },
      authorize: authorizer((target) => {
        if (target.action === "list") throw new Error("secret detail");
        return { allow: true };
      }),
    });
    const result = expectFailure(await read({ path: "/d/a.txt" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({ extension: "authorize", phase: "resolve", id: "test" });
    expect(textOf(result)).not.toContain("secret detail");
    expect(log).toEqual([]);
  });

  test("a throw during the suggest listing gives EXTENSION_FAILED in the open phase", async () => {
    const { fs } = files();
    const read = createReadTool({
      fs,
      authorize: authorizer(() => {
        throw new Error("secret detail");
      }),
    });
    const result = expectFailure(await read({ path: "/d/a.tx" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({ extension: "authorize", phase: "open", id: "test" });
  });

  test("an abort during list approval gives ABORTED", async () => {
    const { fs, log } = files();
    const controller = new AbortController();
    const read = createReadTool({
      fs,
      authorize: authorizer(() => {
        controller.abort();
        return new Promise<never>(() => {});
      }),
    });
    const result = await read({ path: "/d/a.tx" }, { signal: controller.signal });
    expect(expectFailure(result, "ABORTED").notes[0]?.data).toEqual({ phase: "open" });
    expect(log).toEqual(["open /d/a.tx"]);
  });

  test("allow notes from a listing stay on the outcome", async () => {
    const { fs } = files();
    const read = createReadTool({
      fs,
      authorize: authorizer((target) =>
        target.action === "list" ? { allow: true, notes: [NOTE] } : { allow: true },
      ),
    });
    const result = expectFailure(await read({ path: "/d/a.tx" }), "NOT_FOUND");
    expect(result.notes.map((note) => note.code)).toEqual(["not-found", "policy"]);
  });

  test("suggest: null never asks the authorizer to list", async () => {
    const { fs } = files();
    const actions: string[] = [];
    const read = createReadTool({
      fs,
      suggest: null,
      authorize: authorizer((target) => {
        actions.push(target.action);
        return { allow: true };
      }),
    });
    expectFailure(await read({ path: "/d/a.tx" }), "NOT_FOUND");
    expect(actions).toEqual([]);
  });
});
