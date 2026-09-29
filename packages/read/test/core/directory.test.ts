import { describe, expect, test } from "bun:test";

import { memoryFileSystem } from "@better-fs-tools/fs";
import type { FileSystem, ListOptions, MemoryFileSystem } from "@better-fs-tools/fs";

import { createReadTool, directoryListing, textOf } from "../../src/index.ts";
import type {
  ConvertOutcome,
  DirectoryConverter,
  DirectoryConvertInput,
  ReadAuthorizeTarget,
  ReadContext,
  ReadHookContext,
} from "../../src/index.ts";
import { expectFailure, expectMedia, expectOk, lineText, testDigest } from "../helpers.ts";

interface Host {
  readonly id: string;
}

function files(): MemoryFileSystem {
  return memoryFileSystem({
    files: {
      "/d/a.txt": "a\n",
      "/d/b.txt": "b\n",
      "/d/c.txt": "c\n",
      "/d/sub/x.txt": "x\n",
    },
    directories: ["/d/empty"],
  });
}

function listed(inner: FileSystem) {
  const lists: string[] = [];
  const list = inner.list?.bind(inner);
  const fs: FileSystem = {
    id: inner.id,
    capabilities: inner.capabilities,
    paths: inner.paths,
    open: (path, options) => inner.open(path, options),
    ...(list === undefined
      ? {}
      : {
          list(path: string, options: ListOptions) {
            lists.push(path);
            return list(path, options);
          },
        }),
  };
  return { fs, lists };
}

function directoryConverter(
  convert: (input: DirectoryConvertInput, ctx: ReadHookContext<unknown>) => Promise<ConvertOutcome>,
  id = "dir",
): DirectoryConverter<unknown> {
  return { id, target: "directory", convert };
}

describe("directory reads", () => {
  test("a directory converter lists the directory as text", async () => {
    const { fs, lists } = listed(files());
    const read = createReadTool({ fs, digest: testDigest(), converters: [directoryListing()] });
    const result = expectOk(await read({ path: "/d" }));
    expect(lineText(result)).toEqual(["a.txt", "b.txt", "c.txt", "empty", "sub"]);
    expect(lists).toEqual(["/d"]);
    expect(result.classification).toEqual({
      kind: "directory",
      classifier: "fs",
      code: null,
      mimeType: null,
      confidence: "high",
      reasons: ["directory"],
    });
    expect(result.conversion).toEqual({ converter: "directory-listing", mimeType: "text/plain" });
    expect(result.file).toEqual({
      requestedPath: "/d",
      resolvedPath: "/d",
      displayPath: "/d",
      backend: "memory",
      size: null,
      mtimeMs: null,
      identity: null,
      mimeType: null,
      resolvedFrom: null,
      version: null,
    });
    expect(result.observation).toBeNull();
    expect(textOf(result)).toBe("1|a.txt\n2|b.txt\n3|c.txt\n4|empty\n5|sub");
  });

  test("offset and limit page over the entries", async () => {
    const read = createReadTool({ fs: files(), converters: [directoryListing()] });
    const first = expectOk(await read({ path: "/d", limit: 2 }));
    expect(lineText(first)).toEqual(["a.txt", "b.txt"]);
    expect(first.continuation.next).toEqual({ path: "/d", offset: 3, limit: 2 });
    expect(textOf(first)).toContain('Continue with {"path":"/d","offset":3,"limit":2}.');

    const second = expectOk(await read(first.continuation.next ?? { path: "" }));
    expect(lineText(second)).toEqual(["c.txt", "empty"]);
    expect(second.view.startLine).toBe(3);

    const last = expectOk(await read({ path: "/d", offset: 5, limit: 2 }));
    expect(lineText(last)).toEqual(["sub"]);
    expect(last.continuation.available).toBe(false);
  });

  test("without a directory converter, or without list(), a directory is NOT_A_FILE", async () => {
    const plain = createReadTool({ fs: files() });
    expectFailure(await plain({ path: "/d" }), "NOT_A_FILE");

    const unlisted = memoryFileSystem({ files: { "/d/a.txt": "a" }, list: false });
    const read = createReadTool({ fs: unlisted, converters: [directoryListing()] });
    expectFailure(await read({ path: "/d" }), "NOT_A_FILE");
  });

  test("the first directory converter runs; file converters do not see directories", async () => {
    const read = createReadTool({
      fs: files(),
      converters: [
        {
          id: "files",
          target: "file",
          accepts: () => true,
          convert: async () => ({ kind: "text", text: "file", mimeType: null }),
        },
        directoryConverter(async () => ({ kind: "text", text: "first", mimeType: null }), "one"),
        directoryConverter(async () => ({ kind: "text", text: "second", mimeType: null }), "two"),
      ],
    });
    const result = expectOk(await read({ path: "/d" }));
    expect(lineText(result)).toEqual(["first"]);
    expect(result.conversion?.converter).toBe("one");
  });

  test("a converter that never lists makes no listing", async () => {
    const { fs, lists } = listed(files());
    const read = createReadTool({
      fs,
      converters: [
        directoryConverter(async (input) => ({ kind: "text", text: input.path, mimeType: null })),
      ],
    });
    expect(lineText(expectOk(await read({ path: "/d" })))).toEqual(["/d"]);
    expect(lists).toEqual([]);
  });

  test("list() is single use: a second call gets an error outcome", async () => {
    const { fs, lists } = listed(files());
    let second: unknown = null;
    const read = createReadTool({
      fs,
      converters: [
        directoryConverter(async (input) => {
          await input.list();
          second = await input.list();
          return { kind: "text", text: "x", mimeType: null };
        }),
      ],
    });
    expectOk(await read({ path: "/d" }));
    expect(lists).toEqual(["/d"]);
    expect(second).toEqual({
      ok: false,
      error: { reason: "denied", detail: "listing budget spent" },
    });
  });

  test("a media outcome from a directory has no observation", async () => {
    const data = Uint8Array.from([1, 2, 3]);
    const read = createReadTool({
      fs: files(),
      digest: testDigest(),
      converters: [
        directoryConverter(async () => ({
          kind: "media",
          parts: [{ type: "media", mediaType: "image/png", data }],
        })),
      ],
    });
    const result = expectMedia(await read({ path: "/d" }));
    expect(result.observation).toBeNull();
    expect(result.classification.kind).toBe("directory");
  });

  test("a resolver's path is the lexical path, and resolvedFrom is kept", async () => {
    const read = createReadTool({
      fs: files(),
      resolve: { id: "up", resolve: (path) => ({ kind: "path", path: path.toLowerCase() }) },
      converters: [directoryListing()],
    });
    const result = expectOk(await read({ path: "/D" }));
    expect(result.file.resolvedFrom).toBe("/D");
    expect(result.file.resolvedPath).toBe("/d");
  });
});

describe("target null", () => {
  function virtualFsWithoutDirectoryTargets(inner: FileSystem) {
    const lists: string[] = [];
    const fs: FileSystem = {
      id: "virtual",
      capabilities: inner.capabilities,
      paths: inner.paths,
      async open(path, options) {
        const opened = await inner.open(path, options);
        if (opened.ok || opened.error.reason !== "not-a-file") return opened;
        return { ok: false, error: { ...opened.error, target: null } };
      },
      list(path, options) {
        lists.push(path);
        return inner.list?.(path, options) ?? Promise.reject(new Error("no list"));
      },
    };
    return { fs, lists };
  }

  test("the lexical path is listed and shown", async () => {
    const { fs, lists } = virtualFsWithoutDirectoryTargets(files());
    const inputs: DirectoryConvertInput[] = [];
    const listing = directoryListing();
    const read = createReadTool({
      fs,
      converters: [
        directoryConverter(async (input, ctx) => {
          inputs.push(input);
          return listing.convert(input, ctx);
        }),
      ],
    });
    const result = expectOk(await read({ path: "d/./sub" }));
    expect(inputs[0]?.target).toBeNull();
    expect(inputs[0]?.path).toBe("d/./sub");
    expect(lists).toEqual(["d/./sub"]);
    expect(lineText(result)).toEqual(["x.txt"]);
    expect(result.file).toMatchObject({
      requestedPath: "d/./sub",
      resolvedPath: "d/./sub",
      displayPath: "d/./sub",
      backend: "virtual",
    });
  });

  test("the authorizer sees the lexical path", async () => {
    const { fs } = virtualFsWithoutDirectoryTargets(files());
    const targets: ReadAuthorizeTarget[] = [];
    const read = createReadTool({
      fs,
      authorize: {
        id: "log",
        authorize(target) {
          targets.push(target);
          return { allow: true };
        },
      },
      converters: [directoryListing()],
    });
    expectOk(await read({ path: "/d" }));
    expect(targets).toEqual([
      {
        action: "list",
        requestedPath: "/d",
        resolvedPath: "/d",
        displayPath: "/d",
        size: null,
        mtimeMs: null,
      },
    ]);
  });
});

describe("authorize list", () => {
  test("runs before the listing with the target paths from open()", async () => {
    const inner = files();
    const { fs, lists } = listed({
      ...inner,
      async open(path, options) {
        // Simulates "/link" as a symlink to "/d".
        const opened = await inner.open(path === "/link" ? "/d" : path, options);
        if (opened.ok || opened.error.reason !== "not-a-file") return opened;
        return {
          ok: false,
          error: { ...opened.error, target: { resolvedPath: "/d", displayPath: "d" } },
        };
      },
    });
    const log: string[] = [];
    const targets: ReadAuthorizeTarget[] = [];
    const read = createReadTool({
      fs,
      authorize: {
        id: "log",
        authorize(target) {
          log.push(`authorize ${target.action}`);
          targets.push(target);
          return { allow: true };
        },
      },
      converters: [
        directoryConverter(async (input, ctx) => {
          log.push("convert");
          const outcome = await directoryListing().convert(input, ctx);
          log.push(`listed ${lists.join(",")}`);
          return outcome;
        }),
      ],
    });
    const result = expectOk(await read({ path: "/link" }));
    expect(log).toEqual(["convert", "authorize list", "listed /d"]);
    expect(targets[0]).toEqual({
      action: "list",
      requestedPath: "/link",
      resolvedPath: "/d",
      displayPath: "d",
      size: null,
      mtimeMs: null,
    });
    expect(result.file).toMatchObject({ resolvedPath: "/d", displayPath: "d" });
  });

  test("a denied listing gives DENIED, and no fs.list", async () => {
    const { fs, lists } = listed(files());
    const read = createReadTool({
      fs,
      authorize: { id: "no-list", authorize: (target) => ({ allow: target.action !== "list" }) },
      converters: [directoryListing()],
    });
    const result = expectFailure(await read({ path: "/d" }), "DENIED");
    expect(lists).toEqual([]);
    expect(result.file).toBeNull();
    expect(result.notes).toEqual([
      {
        code: "denied",
        severity: "warning",
        message: "/d was refused by policy (refused by the authorizer).",
        data: { detail: "refused by the authorizer" },
      },
    ]);
  });

  test("a converter cannot hide a denied listing", async () => {
    const read = createReadTool({
      fs: files(),
      authorize: { id: "no-list", authorize: () => ({ allow: false }) },
      converters: [
        directoryConverter(async (input) => {
          await input.list();
          return { kind: "text", text: "made up", mimeType: null };
        }),
      ],
    });
    expectFailure(await read({ path: "/d" }), "DENIED");
  });

  test("a throwing list authorizer gives EXTENSION_FAILED, even when the converter goes on", async () => {
    const read = createReadTool({
      fs: files(),
      authorize: {
        id: "broken",
        authorize() {
          throw new Error("boom");
        },
      },
      converters: [
        directoryConverter(async (input) => {
          await input.list();
          return { kind: "text", text: "made up", mimeType: null };
        }),
      ],
    });
    const result = expectFailure(await read({ path: "/d" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({
      extension: "authorize",
      phase: "conversion",
      id: "broken",
    });
  });

  test("a listing error from the backend ends the read with that failure", async () => {
    const inner = files();
    const read = createReadTool({
      fs: {
        ...inner,
        list: async () => ({ ok: false, error: { reason: "permission-denied" } }),
      },
      converters: [directoryListing()],
    });
    expectFailure(await read({ path: "/d" }), "PERMISSION_DENIED");
  });
});

describe("host code failures", () => {
  test("a throwing directory converter gives EXTENSION_FAILED with its id", async () => {
    const read = createReadTool({
      fs: files(),
      converters: [
        directoryConverter(async () => {
          throw new Error("boom");
        }, "tree"),
      ],
    });
    const result = expectFailure(await read({ path: "/d" }), "EXTENSION_FAILED");
    expect(result.notes[0]?.data).toEqual({
      extension: "converters",
      phase: "conversion",
      id: "tree",
    });
  });

  test("an abort while the converter waits gives ABORTED", async () => {
    const controller = new AbortController();
    const read = createReadTool({
      fs: files(),
      converters: [
        directoryConverter(async () => {
          controller.abort();
          return new Promise<ConvertOutcome>(() => {});
        }),
      ],
    });
    const result = expectFailure(
      await read({ path: "/d" }, { signal: controller.signal }),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "conversion" });
  });
});

describe("the call object", () => {
  test("the directory converter gets the same call object the caller passed", async () => {
    const call: ReadContext<Host> = { host: { id: "h1" }, callId: "c1" };
    const seen: ReadHookContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: files(),
      converters: [
        {
          id: "host",
          target: "directory",
          async convert(_input, ctx) {
            seen.push(ctx);
            return { kind: "text", text: ctx.call.host.id, mimeType: null };
          },
        },
      ],
    });
    const result = expectOk(await read({ path: "/d" }, call));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.call).toBe(call);
    expect(lineText(result)).toEqual(["h1"]);
  });
});
