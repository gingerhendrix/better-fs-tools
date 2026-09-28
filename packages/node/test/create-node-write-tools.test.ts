import { afterAll, describe, expect, test } from "bun:test";

import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { memoryFileSystem } from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";
import type { ToolCallContext } from "@better-fs-tools/read";
import { createMemoryStore } from "@better-fs-tools/read/state";

import {
  createNodeApplyPatchTool,
  createNodeEditTool,
  createNodeWriteTool,
  nodeFileSystem,
} from "../src/index.ts";

const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-write-")));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const PATCH = (path: string) =>
  ["*** Begin Patch", `*** Add File: ${path}`, "+patched", "*** End Patch"].join("\n");

describe("createNode*Tool defaults", () => {
  test("with no arguments each tool refuses a path outside process.cwd()", async () => {
    const outside = join(root, "outside.txt");
    const results = [
      await createNodeWriteTool()({ path: outside, content: "x\n" }),
      await createNodeEditTool()({ path: outside, edits: [{ oldText: "x", newText: "y" }] }),
      await createNodeApplyPatchTool()({ patch: PATCH(outside) }),
    ];
    for (const result of results) expect(errorOf(result)?.code).toBe("OUTSIDE_ALLOWED_ROOTS");
  });

  test("state stays null: a write and an edit need no read, and say so", async () => {
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const write = await createNodeWriteTool({ fs })({ path: "a.txt", content: "one\n" });
    expect(write.status).toBe("ok");

    const edit = await createNodeEditTool({ fs })({
      path: "a.txt",
      edits: [{ oldText: "one", newText: "two" }],
    });
    expect(edit.status).toBe("ok");
    expect(edit.notes.map((note) => note.code)).toContain("read-before-write-off");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("two\n");

    const patch = await createNodeApplyPatchTool({ fs })({ patch: PATCH("b.txt") });
    expect(patch.status).toBe("ok");
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("patched\n");
  });

  test("digest defaults to nodeDigest, and digest: null turns it off", async () => {
    const fs = memoryFileSystem({ files: {} });
    const hashed = await createNodeWriteTool({ fs })({ path: "/h.txt", content: "x\n" });
    expect(hashed.changes[0]?.after?.contentId).toStartWith("sha256:");
    const bare = await createNodeWriteTool({ fs, digest: null })({
      path: "/n.txt",
      content: "x\n",
    });
    expect(bare.changes[0]?.after?.contentId).toBeNull();
  });

  test("a state without a digest is refused, as in the core", () => {
    expect(() => createNodeEditTool({ state: createMemoryStore(), digest: null })).toThrow(
      TypeError,
    );
  });

  test("other dependencies pass through with the same call object", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "x\n" } });
    const seen: unknown[] = [];
    const call: ToolCallContext<{ id: string }> = { host: { id: "h" } };
    const write = createNodeWriteTool<{ id: string }>({
      fs: (ctx) => {
        seen.push(ctx);
        return fs;
      },
    });
    const result = await write({ path: "/a.txt", content: "y\n" }, call);
    expect(textOf(result)).toBe(
      "Updated /a.txt (+1 -1 lines).\n\n[write:read-before-write-off] Read-before-write is off: this tool has no state store.",
    );
    expect(seen).toEqual([call]);
    expect(seen[0]).toBe(call);
  });

  test("non-object dependencies throw TypeError", () => {
    expect(() => createNodeEditTool(null as never)).toThrow(TypeError);
    expect(() => createNodeWriteTool([] as never)).toThrow(TypeError);
    expect(() => createNodeApplyPatchTool("x" as never)).toThrow(TypeError);
  });

  test("a file written on disk keeps working with the default fs of a given cwd", async () => {
    await writeFile(join(root, "c.txt"), "c\n");
    const fs = nodeFileSystem({ cwd: root, allowedRoots: [root] });
    const result = await createNodeEditTool({ fs })({
      path: "c.txt",
      edits: [{ oldText: "c", newText: "C" }],
    });
    expect(result.changes[0]?.resolvedPath).toBe(join(root, "c.txt"));
  });
});

/** The error of a result, or null when its status is not "error". */
function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
