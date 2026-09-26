import { describe, expect, test } from "bun:test";

import { createReadTool, textOf } from "@better-fs-tools/read";
import type { ReadContext } from "@better-fs-tools/read";
import { InMemoryFs } from "just-bash";
import type { IFileSystem } from "just-bash";

import { justBashReadFileSystem } from "../src/index.ts";
import type { JustBashReadFileSystem } from "../src/index.ts";
import { adapter } from "./backend.ts";
import { expectFailure, expectOk } from "./helpers.ts";

describe("just-bash through the read tool", () => {
  test("reads a file with a strong identity and discloses buffering", async () => {
    const fs = new InMemoryFs({ "/workspace/src/index.ts": "const a = 1;\nconst b = 2;\n" });
    const read = createReadTool({ fs: adapter(fs) });
    const result = expectOk(await read({ path: "src/index.ts" }));

    expect(textOf(result)).toStartWith("1|const a = 1;\n2|const b = 2;");
    expect(result.file.backend).toBe("test-just-bash");
    expect(result.file.displayPath).toBe("src/index.ts");
    expect(result.file.identity).toContain("test-just-bash");
    const codes = result.notes.map((note) => note.code);
    expect(codes).not.toContain("weak-identity");
    expect(codes).toContain("buffered-backend");
  });

  test("refuses binary content, escapes, and missing files", async () => {
    const fs = new InMemoryFs({
      "/workspace/logo.png": new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
      ]),
    });
    const read = createReadTool({ fs: adapter(fs) });

    expect((await read({ path: "logo.png" })).status).toBe("unsupported");
    expectFailure(await read({ path: "/etc/passwd" }), "OUTSIDE_ALLOWED_ROOTS");
    expectFailure(await read({ path: "missing.md" }), "NOT_FOUND");
  });

  test("a directory gives NOT_A_FILE with kind directory", async () => {
    const fs = new InMemoryFs({ "/workspace/dir/a.txt": "a\n" });
    const read = createReadTool({ fs: adapter(fs) });
    const result = expectFailure(await read({ path: "dir" }), "NOT_A_FILE");
    expect(result.notes[0]?.data?.kind).toBe("directory");
  });

  test("an edit between reads changes the identity", async () => {
    const fs = new InMemoryFs({ "/workspace/a.txt": "alpha\n" });
    const read = createReadTool({ fs: adapter(fs) });
    const before = expectOk(await read({ path: "a.txt" }));
    await fs.writeFile("/workspace/a.txt", "bravo\n");
    const after = expectOk(await read({ path: "a.txt" }));
    expect(textOf(after)).toStartWith("1|bravo");
    expect(after.file.identity).not.toBe(before.file.identity);
  });

  test("an fs factory gets the caller's call object and can pick a filesystem per call", async () => {
    interface Host {
      readonly fs: IFileSystem;
    }
    const calls: ReadContext<Host>[] = [];
    const read = createReadTool<Host>({
      fs: (call): JustBashReadFileSystem => {
        calls.push(call);
        return justBashReadFileSystem(call.host.fs, {
          id: "per-call",
          cwd: "/workspace",
          allowedRoots: ["/workspace"],
          maxBufferedBytes: 1_024,
        });
      },
    });
    const first: ReadContext<Host> = {
      host: { fs: new InMemoryFs({ "/workspace/a.txt": "one\n" }) },
    };
    const second: ReadContext<Host> = {
      host: { fs: new InMemoryFs({ "/workspace/a.txt": "two\n" }) },
      callId: "c2",
    };
    expect(textOf(expectOk(await read({ path: "a.txt" }, first)))).toStartWith("1|one");
    expect(textOf(expectOk(await read({ path: "a.txt" }, second)))).toStartWith("1|two");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(first);
    expect(calls[1]).toBe(second);
  });
});
