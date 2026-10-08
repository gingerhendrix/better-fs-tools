import { describe, expect, test } from "bun:test";

import { createReadTool, textOf } from "@better-fs-tools/read";
import type { ReadContext } from "@better-fs-tools/read";

import { cloudflareComputerFileSystem } from "../src/index.ts";
import type { CloudflareComputerFileSystem } from "../src/index.ts";
import { ROOT, fakeComputer, fsFor, streamOf } from "./fake-computer.ts";
import type { FakeComputer } from "./fake-computer.ts";
import { expectFailure, expectOk } from "./helpers.ts";

const ENCODER = new TextEncoder();

function readFor(files: Record<string, string | Uint8Array> = {}, maxScanBytes?: number) {
  const { backend, fs } = fsFor(files);
  return {
    backend,
    fs,
    read: createReadTool({
      fs,
      ...(maxScanBytes === undefined ? {} : { limits: { maxScanBytes } }),
    }),
  };
}

describe("computer filesystem through the read tool", () => {
  test("reads a file with a null identity and no capability notes", async () => {
    const { read } = readFor({ "/workspace/src/index.ts": "const a = 1;\nconst b = 2;\n" });
    const result = expectOk(await read({ path: "src/index.ts" }));

    expect(textOf(result)).toStartWith("1|const a = 1;\n2|const b = 2;");
    expect(result.file.backend).toBe("cloudflare-computer");
    expect(result.file.displayPath).toBe("src/index.ts");
    expect(result.file.identity).toBeNull();
    const codes = result.notes.map((note) => note.code);
    expect(codes).toEqual([]);
  });

  test("refuses binary content, escapes, and missing files", async () => {
    const { read } = readFor({
      "/workspace/logo.png": new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
      ]),
    });

    expect((await read({ path: "logo.png" })).status).toBe("unsupported");
    expectFailure(await read({ path: "/etc/passwd" }), "OUTSIDE_ALLOWED_ROOTS");
    expectFailure(await read({ path: "missing.md" }), "NOT_FOUND");
  });

  test("a directory gives NOT_A_FILE with kind directory", async () => {
    const { read } = readFor({ "/workspace/dir/a.txt": "a\n" });
    const result = expectFailure(await read({ path: "dir" }), "NOT_A_FILE");
    expect(result.notes[0]?.data?.kind).toBe("directory");
  });

  test("a stream shorter than the reported size is a mid-read change", async () => {
    const { backend, read } = readFor({ "/workspace/a.txt": "alpha\nbeta\n" });
    backend.override.readFile = (path: string) =>
      streamOf(ENCODER.encode("al"), path, backend.cancelled, 8);
    expectFailure(await read({ path: "a.txt" }), "CHANGED_DURING_READ");
  });

  test("a malformed stream becomes IO_ERROR", async () => {
    const { backend, read } = readFor({ "/workspace/a.txt": "alpha\n" });
    backend.override.readFile = () => ({
      getReader: () => ({
        read: async () => ({ done: false, value: "alpha" }),
        cancel: () => {},
      }),
      cancel: () => {},
    });
    expectFailure(await read({ path: "a.txt" }), "IO_ERROR");
  });

  test("cancels the stream when the scan limit stops the read", async () => {
    const body = `${"x".repeat(200)}\n`.repeat(20);
    const { backend, read } = readFor({ "/workspace/big.txt": body }, 256);
    const result = expectOk(await read({ path: "big.txt" }));
    expect(result.totals.exact).toBe(false);
    await Promise.resolve();
    expect(backend.cancelled).toEqual(["/workspace/big.txt"]);
  });

  test("cancels the stream when the caller aborts mid-scan", async () => {
    const { backend, read } = readFor({ "/workspace/big.txt": "line\n".repeat(400) });
    backend.chunkSize = 4;
    const controller = new AbortController();
    backend.override.readFile = (path: string) => {
      queueMicrotask(() => controller.abort());
      return streamOf(ENCODER.encode("line\n".repeat(400)), path, backend.cancelled, 4);
    };

    expectFailure(await read({ path: "big.txt" }, { signal: controller.signal }), "ABORTED");
    await Promise.resolve();
    expect(backend.cancelled).toEqual(["/workspace/big.txt"]);
  });

  test("an fs factory gets the caller's call object and can pick a backend per call", async () => {
    interface Host {
      readonly backend: FakeComputer;
    }
    const calls: ReadContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: (call): CloudflareComputerFileSystem => {
        calls.push(call);
        return cloudflareComputerFileSystem(call.host.backend, { allowedRoots: [ROOT] });
      },
    });
    const first: ReadContext<Host> = {
      host: { backend: fakeComputer({ "/workspace/a.txt": "one\n" }) },
    };
    const second: ReadContext<Host> = {
      host: { backend: fakeComputer({ "/workspace/a.txt": "two\n" }) },
      callId: "c2",
    };
    expect(textOf(expectOk(await read({ path: "a.txt" }, first)))).toStartWith("1|one");
    expect(textOf(expectOk(await read({ path: "a.txt" }, second)))).toStartWith("1|two");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(first);
    expect(calls[1]).toBe(second);
  });
});
