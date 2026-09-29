import { describe, expect, test } from "bun:test";

import type { FileSystem, OpenFile } from "@better-fs-tools/fs";

import { createReadTool } from "../../src/index.ts";
import { expectFailure, expectOk, harness } from "../helpers.ts";

function mapOpenedFiles(fs: FileSystem, change: (file: OpenFile) => OpenFile): FileSystem {
  return {
    ...fs,
    async open(path, options) {
      const opened = await fs.open(path, options);
      return opened.ok ? { ok: true, file: change(opened.file) } : opened;
    },
  };
}

describe("change detection", () => {
  test("a file changed under the handle fails the read", async () => {
    const { fs } = harness({ files: { "/a.txt": "one\n" } });
    const mutating: FileSystem = {
      ...fs,
      async open(path, options) {
        const opened = await fs.open(path, options);
        if (opened.ok) fs.setFile("/a.txt", "two\n");
        return opened;
      },
    };
    const result = expectFailure(
      await createReadTool({ fs: mutating })({ path: "/a.txt" }),
      "CHANGED_DURING_READ",
    );
    expect(result.notes[0]?.retry).toEqual({ path: "/a.txt", offset: 1, limit: 2_000 });
    expect(result.file?.resolvedPath).toBe("/a.txt");
  });

  test("verify runs after the scan, on every text read", async () => {
    const { fs } = harness({ files: { "/a.txt": "one\n" } });
    const events: string[] = [];
    const tracing = mapOpenedFiles(fs, (file) => ({
      ...file,
      bytes: () => {
        events.push("bytes");
        return file.bytes();
      },
      verify: async () => {
        events.push("verify");
        return file.verify();
      },
      close: async () => {
        events.push("close");
        return file.close();
      },
    }));
    expectOk(await createReadTool({ fs: tracing })({ path: "/a.txt" }));
    expect(events).toEqual(["bytes", "verify", "close"]);
  });

  test("a byte count that disagrees with the reported size fails the read", async () => {
    const { fs } = harness({ files: { "/a.txt": "one\n" } });
    const lying = mapOpenedFiles(fs, (file) => ({ ...file, info: { ...file.info, size: 99 } }));
    expectFailure(await createReadTool({ fs: lying })({ path: "/a.txt" }), "CHANGED_DURING_READ");
  });

  test("a verify error maps through the filesystem error", async () => {
    const { fs } = harness({ files: { "/a.txt": "one\n" } });
    const failing = mapOpenedFiles(fs, (file) => ({
      ...file,
      verify: async () => ({ ok: false, error: { reason: "io", detail: "gone" } }),
    }));
    const result = expectFailure(
      await createReadTool({ fs: failing })({ path: "/a.txt" }),
      "IO_ERROR",
    );
    expect(result.notes[0]?.data).toEqual({ detail: "gone" });
  });
});

describe("handle cleanup", () => {
  const cases: [string, Record<string, string | Uint8Array>, string][] = [
    ["ok", { "/f": "text\n" }, "ok"],
    ["unsupported", { "/f": new Uint8Array([0, 1, 2]) }, "unsupported"],
    ["late invalid UTF-8", { "/f": new Uint8Array([0x61, 0x0a, 0xff]) }, "unsupported"],
  ];
  for (const [name, files, status] of cases) {
    test(`closes the handle for ${name}`, async () => {
      const { fs } = harness({ files });
      let closed = 0;
      const counting = mapOpenedFiles(fs, (file) => ({
        ...file,
        close: async () => {
          closed += 1;
          return file.close();
        },
      }));
      const result = await createReadTool({
        fs: counting,
        limits: { sampleBytes: 2 },
      })({ path: "/f" });
      expect(result.status).toBe(status as typeof result.status);
      expect(closed).toBe(1);
    });
  }

  test("closes the handle when the byte source throws", async () => {
    const { fs } = harness({ files: { "/f": "x\n" } });
    let closed = 0;
    const throwing = mapOpenedFiles(fs, (file) => ({
      ...file,
      bytes: () => {
        throw new Error("adapter defect");
      },
      close: async () => {
        closed += 1;
      },
    }));
    expectFailure(await createReadTool({ fs: throwing })({ path: "/f" }), "IO_ERROR");
    expect(closed).toBe(1);
  });

  test("closes the handle when the read is aborted mid-scan", async () => {
    const { fs } = harness({ files: { "/f": "x\n".repeat(100) } });
    const controller = new AbortController();
    let closed = 0;
    const aborting = mapOpenedFiles(fs, (file) => ({
      ...file,
      bytes: () =>
        (async function* abortAfterFirst() {
          for await (const chunk of file.bytes()) {
            yield chunk;
            controller.abort();
          }
        })(),
      close: async () => {
        closed += 1;
      },
    }));
    const result = expectFailure(
      await createReadTool({ fs: aborting, limits: { sampleBytes: 4 } })(
        { path: "/f" },
        { signal: controller.signal },
      ),
      "ABORTED",
    );
    expect(result.notes[0]?.data).toEqual({ phase: "scan" });
    expect(closed).toBe(1);
  });
});
