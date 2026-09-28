import { describe, expect, test } from "bun:test";

import { createReadTool, textOf } from "@better-fs-tools/read";
import type { ReadContext } from "@better-fs-tools/read";

import { cloudflareShellFileSystem } from "../src/index.ts";
import type { CloudflareShellFileSystem } from "../src/index.ts";
import { ROOT, fakeWorkspace, fsFor } from "./fake-workspace.ts";
import type { FakeWorkspace } from "./fake-workspace.ts";
import { expectFailure, expectOk } from "./helpers.ts";

function readFor(files: Record<string, string | Uint8Array> = {}) {
  const { workspace, fs } = fsFor(files);
  return { workspace, fs, read: createReadTool({ fs }) };
}

describe("shell workspace through the read tool", () => {
  test("reads a file and discloses both weak capabilities", async () => {
    const { read } = readFor({ "/workspace/src/index.ts": "const a = 1;\nconst b = 2;\n" });
    const result = expectOk(await read({ path: "src/index.ts" }));

    expect(textOf(result)).toStartWith("1|const a = 1;\n2|const b = 2;");
    expect(result.file.backend).toBe("cloudflare-shell");
    expect(result.file.displayPath).toBe("src/index.ts");
    expect(result.file.identity).toBeNull();
    const codes = result.notes.map((note) => note.code);
    expect(codes).toContain("weak-identity");
    expect(codes).toContain("buffered-backend");
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

  test("forwards the caller's abort signal", async () => {
    const { workspace, read } = readFor({ "/workspace/a.txt": "alpha\n" });
    const controller = new AbortController();
    controller.abort();
    expectFailure(await read({ path: "a.txt" }, { signal: controller.signal }), "ABORTED");
    expect(workspace.calls).toEqual([]);
  });

  test("an fs factory gets the caller's call object and can pick a workspace per call", async () => {
    interface Host {
      readonly workspace: FakeWorkspace;
    }
    const calls: ReadContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: (call): CloudflareShellFileSystem => {
        calls.push(call);
        return cloudflareShellFileSystem(call.host.workspace, { allowedRoots: [ROOT] });
      },
    });
    const first: ReadContext<Host> = {
      host: { workspace: fakeWorkspace({ "/workspace/a.txt": "one\n" }) },
    };
    const second: ReadContext<Host> = {
      host: { workspace: fakeWorkspace({ "/workspace/a.txt": "two\n" }) },
      callId: "c2",
    };
    expect(textOf(expectOk(await read({ path: "a.txt" }, first)))).toStartWith("1|one");
    expect(textOf(expectOk(await read({ path: "a.txt" }, second)))).toStartWith("1|two");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(first);
    expect(calls[1]).toBe(second);
  });
});
