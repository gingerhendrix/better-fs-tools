import { describe, expect, test } from "bun:test";

import { createReadTool, memoryStore, textOf } from "@better-fs-tools/read";
import {
  createApplyPatchTool,
  createEditTool,
  createWriteTool,
  memoryLocks,
} from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";

import { fsFor } from "./fake-computer.ts";
import { errorOf, testDigest } from "./helpers.ts";

const DECODER = new TextDecoder();

/** The read tool and the three write tools over one Computer adapter, store, digest and lock manager. */
function toolsFor(files: Record<string, string> = {}) {
  const { backend, fs } = fsFor(files);
  const shared = { fs, state: memoryStore(), digest: testDigest(), locks: memoryLocks() };
  return {
    backend,
    read: createReadTool({ fs, state: shared.state, digest: shared.digest }),
    edit: createEditTool(shared),
    write: createWriteTool(shared),
    applyPatch: createApplyPatchTool(shared),
    text: (path: string) => {
      const bytes = backend.entries.get(path)?.bytes;
      return bytes === undefined ? undefined : DECODER.decode(bytes);
    },
  };
}

function codes(result: MutationResult): string[] {
  return result.notes.map((note) => note.code);
}

describe("cloudflare computer through the write tools", () => {
  test("edit after a read keeps the mode and shows only the compare-and-swap note", async () => {
    const tools = toolsFor({ "/workspace/run.sh": "#!/bin/sh\necho one\n" });
    const entry = tools.backend.entries.get("/workspace/run.sh");
    if (entry !== undefined) entry.mode = 0o755;
    expect((await tools.read({ path: "run.sh" })).status).toBe("ok");

    const result = await tools.edit({
      path: "run.sh",
      edits: [{ oldText: "echo one", newText: "echo two" }],
    });
    expect(result.status).toBe("ok");
    expect(tools.text("/workspace/run.sh")).toBe("#!/bin/sh\necho two\n");
    expect(tools.backend.entries.get("/workspace/run.sh")?.mode).toBe(0o755);
    expect(codes(result)).toContain("no-compare-and-swap");
    expect(codes(result)).not.toContain("not-atomic");
    expect(codes(result)).not.toContain("mode-not-kept");
    expect(textOf(result)).toContain(
      "The cloudflare-computer backend cannot check the file version at the moment of the write.",
    );
  });

  test("write creates a file in new folders, and needs a read to replace one", async () => {
    const tools = toolsFor({ "/workspace/README.md": "old\n" });
    const created = await tools.write({ path: "docs/guide/intro.md", content: "# Intro\n" });
    expect(created.status).toBe("ok");
    expect(tools.text("/workspace/docs/guide/intro.md")).toBe("# Intro\n");
    expect(codes(created)).toEqual(
      expect.arrayContaining(["no-compare-and-swap", "directories-created"]),
    );

    expect(errorOf(await tools.write({ path: "README.md", content: "new\n" }))?.code).toBe(
      "NOT_READ",
    );
    await tools.read({ path: "README.md" });
    expect((await tools.write({ path: "README.md", content: "new\n" })).status).toBe("ok");
    expect(tools.text("/workspace/README.md")).toBe("new\n");
  });

  test("a same-size change with the same mtime is still STALE", async () => {
    const tools = toolsFor({ "/workspace/a.txt": "one\n" });
    await tools.read({ path: "a.txt" });
    const entry = tools.backend.entries.get("/workspace/a.txt");
    if (entry === undefined) throw new Error("missing fixture");
    entry.bytes = new TextEncoder().encode("two\n");

    const result = await tools.write({ path: "a.txt", content: "three\n" });
    expect(errorOf(result)?.code).toBe("STALE");
    expect(tools.text("/workspace/a.txt")).toBe("two\n");
  });

  test("a symlink is refused and nothing is written", async () => {
    const tools = toolsFor({ "/workspace/real.txt": "real\n" });
    tools.backend.link("/workspace/link.txt", "/workspace/real.txt");

    const result = await tools.write({ path: "link.txt", content: "through the link\n" });
    expect(errorOf(result)?.code).toBe("DENIED");
    expect(tools.text("/workspace/real.txt")).toBe("real\n");
    expect(tools.backend.calls.some((call) => call.startsWith("writeFile:"))).toBe(false);
  });

  test("apply_patch adds, updates and deletes without stage()", async () => {
    const tools = toolsFor({ "/workspace/a.txt": "one\ntwo\n", "/workspace/old.txt": "bye\n" });
    await tools.read({ path: "a.txt" });
    await tools.read({ path: "old.txt" });

    const result = await tools.applyPatch({
      patch: [
        "*** Begin Patch",
        "*** Update File: a.txt",
        "@@",
        " one",
        "-two",
        "+TWO",
        "*** Add File: new/b.txt",
        "+hello",
        "*** Delete File: old.txt",
        "*** End Patch",
      ].join("\n"),
    });
    expect(result.status).toBe("ok");
    expect(tools.text("/workspace/a.txt")).toBe("one\nTWO\n");
    expect(tools.text("/workspace/new/b.txt")).toBe("hello\n");
    expect(tools.backend.entries.has("/workspace/old.txt")).toBe(false);
  });
});
