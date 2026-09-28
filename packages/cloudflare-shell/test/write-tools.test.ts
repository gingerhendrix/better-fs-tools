import { describe, expect, test } from "bun:test";

import { createMemoryStore, createReadTool, textOf } from "@better-fs-tools/read";
import {
  createApplyPatchTool,
  createEditTool,
  createWriteTool,
  memoryLocks,
} from "@better-fs-tools/write";
import type { MutationResult } from "@better-fs-tools/write";

import { fsFor } from "./fake-workspace.ts";
import { errorOf, testDigest } from "./helpers.ts";

const DECODER = new TextDecoder();

/** The read tool and the three write tools over one Shell adapter, store, digest and lock manager. */
function toolsFor(files: Record<string, string> = {}) {
  const { workspace, fs } = fsFor(files);
  const shared = { fs, state: createMemoryStore(), digest: testDigest(), locks: memoryLocks() };
  return {
    workspace,
    read: createReadTool({ fs, state: shared.state, digest: shared.digest }),
    edit: createEditTool(shared),
    write: createWriteTool(shared),
    applyPatch: createApplyPatchTool(shared),
    text: (path: string) => {
      const bytes = workspace.entries.get(path)?.bytes;
      return bytes === undefined ? undefined : DECODER.decode(bytes);
    },
  };
}

function codes(result: MutationResult): string[] {
  return result.notes.map((note) => note.code);
}

describe("shell workspace through the write tools", () => {
  test("edit after a read changes the file and shows the capability notes", async () => {
    const tools = toolsFor({ "/workspace/app.ts": "const a = 1;\nconst b = 2;\n" });
    expect((await tools.read({ path: "app.ts" })).status).toBe("ok");

    const result = await tools.edit({
      path: "app.ts",
      edits: [{ oldText: "a = 1", newText: "a = 10" }],
    });
    expect(result.status).toBe("ok");
    expect(tools.text("/workspace/app.ts")).toBe("const a = 10;\nconst b = 2;\n");
    expect(codes(result)).toEqual(
      expect.arrayContaining(["not-atomic", "no-compare-and-swap", "mode-not-kept"]),
    );
    expect(textOf(result)).toContain(
      "The cloudflare-shell backend cannot check the file version at the moment of the write.",
    );

    // A second edit needs no new read.
    const again = await tools.edit({
      path: "app.ts",
      edits: [{ oldText: "b = 2", newText: "b = 20" }],
    });
    expect(again.status).toBe("ok");
    expect(tools.text("/workspace/app.ts")).toBe("const a = 10;\nconst b = 20;\n");
  });

  test("write creates a file in new folders and replaces a read file", async () => {
    const tools = toolsFor({ "/workspace/README.md": "old\n" });
    const created = await tools.write({ path: "docs/guide/intro.md", content: "# Intro\n" });
    expect(created.status).toBe("ok");
    expect(tools.text("/workspace/docs/guide/intro.md")).toBe("# Intro\n");
    expect(codes(created)).toEqual(
      expect.arrayContaining(["not-atomic", "no-compare-and-swap", "directories-created"]),
    );
    // A create has no mode to keep.
    expect(codes(created)).not.toContain("mode-not-kept");

    expect(errorOf(await tools.write({ path: "README.md", content: "new\n" }))?.code).toBe(
      "NOT_READ",
    );
    await tools.read({ path: "README.md" });
    expect((await tools.write({ path: "README.md", content: "new\n" })).status).toBe("ok");
    expect(tools.text("/workspace/README.md")).toBe("new\n");
  });

  test("a same-size change inside Shell's one-second clock is still STALE", async () => {
    const tools = toolsFor({ "/workspace/a.txt": "one\n" });
    await tools.read({ path: "a.txt" });
    // Shell stores whole seconds. Keep size and updatedAt, change the bytes.
    const entry = tools.workspace.entries.get("/workspace/a.txt");
    if (entry === undefined) throw new Error("missing fixture");
    entry.bytes = new TextEncoder().encode("two\n");

    const result = await tools.write({ path: "a.txt", content: "three\n" });
    expect(errorOf(result)?.code).toBe("STALE");
    expect(tools.text("/workspace/a.txt")).toBe("two\n");
  });

  test("a symlink is refused and nothing is written", async () => {
    const tools = toolsFor({ "/workspace/real.txt": "real\n" });
    tools.workspace.link("/workspace/link.txt", "/workspace/real.txt");

    const result = await tools.write({ path: "link.txt", content: "through the link\n" });
    expect(errorOf(result)?.code).toBe("DENIED");
    expect(tools.text("/workspace/real.txt")).toBe("real\n");
    expect(tools.workspace.calls.some((call) => call.startsWith("writeFileBytes:"))).toBe(false);
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
    expect(tools.workspace.entries.has("/workspace/old.txt")).toBe(false);
    expect(codes(result)).toContain("no-compare-and-swap");
  });

  test("a failed backend write in a patch undoes the files already written", async () => {
    const tools = toolsFor({ "/workspace/a.txt": "one\n", "/workspace/b.txt": "two\n" });
    await tools.read({ path: "a.txt" });
    await tools.read({ path: "b.txt" });
    const original = tools.workspace.writeFileBytes.bind(tools.workspace);
    // The first write of b.txt fails. Every other write, and the undo, goes through.
    let failed = false;
    tools.workspace.writeFileBytes = async (path, data, mimeType) => {
      if (path === "/workspace/b.txt" && !failed) {
        failed = true;
        throw new Error("database is locked");
      }
      return original(path, data, mimeType);
    };

    const result = await tools.applyPatch({
      patch: [
        "*** Begin Patch",
        "*** Update File: a.txt",
        "-one",
        "+ONE",
        "*** Update File: b.txt",
        "-two",
        "+TWO",
        "*** End Patch",
      ].join("\n"),
    });
    expect(errorOf(result)?.code).toBe("IO_ERROR");
    expect(result.commit?.rolledBack).toBe(true);
    expect(tools.text("/workspace/a.txt")).toBe("one\n");
    expect(tools.text("/workspace/b.txt")).toBe("two\n");
  });
});
