import { describe, expect, test } from "bun:test";

import { createReadTool, memoryStore, textOf } from "@better-fs-tools/read";
import {
  createApplyPatchTool,
  createEditTool,
  createWriteTool,
  memoryLocks,
} from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";
import { InMemoryFs } from "just-bash";

import { writable } from "./backend.ts";
import { errorOf, testDigest } from "./helpers.ts";

function toolsFor(files: Record<string, string>) {
  const backend = new InMemoryFs(files);
  const fs = writable(backend, { identity: "none", maxBufferedBytes: 1024 * 1024 });
  const shared = { fs, state: memoryStore(), digest: testDigest(), locks: memoryLocks() };
  return {
    backend,
    read: createReadTool({ fs, state: shared.state, digest: shared.digest }),
    edit: createEditTool(shared),
    write: createWriteTool(shared),
    applyPatch: createApplyPatchTool(shared),
  };
}

function codes(result: MutationResult): string[] {
  return result.notes.map((note) => note.code);
}

describe("just-bash through the write tools", () => {
  test("edit after a read keeps the mode and shows the capability notes", async () => {
    const tools = toolsFor({ "/workspace/run.sh": "#!/bin/sh\necho one\n" });
    await tools.backend.chmod("/workspace/run.sh", 0o755);
    expect((await tools.read({ path: "run.sh" })).status).toBe("ok");

    const result = await tools.edit({
      path: "run.sh",
      edits: [{ oldText: "echo one", newText: "echo two" }],
    });
    expect(result.status).toBe("ok");
    expect(await tools.backend.readFile("/workspace/run.sh")).toBe("#!/bin/sh\necho two\n");
    expect((await tools.backend.stat("/workspace/run.sh")).mode & 0o7777).toBe(0o755);
    expect(codes(result)).toEqual(expect.arrayContaining(["not-atomic", "no-compare-and-swap"]));
    expect(codes(result)).not.toContain("mode-not-kept");
    expect(textOf(result)).toContain(
      "The test-just-bash backend does not replace files atomically",
    );

    const again = await tools.edit({
      path: "run.sh",
      edits: [{ oldText: "#!/bin/sh", newText: "#!/bin/bash" }],
    });
    expect(again.status).toBe("ok");
    expect(await tools.backend.readFile("/workspace/run.sh")).toBe("#!/bin/bash\necho two\n");
  });

  test("write creates a file in new folders, and needs a read to replace one", async () => {
    const tools = toolsFor({ "/workspace/README.md": "old\n" });
    const created = await tools.write({ path: "docs/guide/intro.md", content: "# Intro\n" });
    expect(created.status).toBe("ok");
    expect(await tools.backend.readFile("/workspace/docs/guide/intro.md")).toBe("# Intro\n");
    expect(codes(created)).toContain("directories-created");

    expect(errorOf(await tools.write({ path: "README.md", content: "new\n" }))?.code).toBe(
      "NOT_READ",
    );
    await tools.read({ path: "README.md" });
    expect((await tools.write({ path: "README.md", content: "new\n" })).status).toBe("ok");
  });

  test("a same-size change by another writer with the same mtime is still STALE", async () => {
    const tools = toolsFor({ "/workspace/a.txt": "one\n" });
    await tools.read({ path: "a.txt" });
    const { mtime } = await tools.backend.stat("/workspace/a.txt");
    await tools.backend.writeFile("/workspace/a.txt", "two\n");
    await tools.backend.utimes("/workspace/a.txt", mtime, mtime);

    const result = await tools.write({ path: "a.txt", content: "three\n" });
    expect(errorOf(result)?.code).toBe("STALE");
    expect(await tools.backend.readFile("/workspace/a.txt")).toBe("two\n");
  });

  test("a symlink is refused and the link stays", async () => {
    const tools = toolsFor({ "/workspace/real.txt": "real\n" });
    await tools.backend.symlink("/workspace/real.txt", "/workspace/link.txt");

    const result = await tools.write({ path: "link.txt", content: "through the link\n" });
    expect(errorOf(result)?.code).toBe("DENIED");
    expect(await tools.backend.readFile("/workspace/real.txt")).toBe("real\n");
    expect((await tools.backend.lstat("/workspace/link.txt")).isSymbolicLink).toBe(true);
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
    expect(await tools.backend.readFile("/workspace/a.txt")).toBe("one\nTWO\n");
    expect(await tools.backend.readFile("/workspace/new/b.txt")).toBe("hello\n");
    expect(await tools.backend.exists("/workspace/old.txt")).toBe(false);
  });
});
