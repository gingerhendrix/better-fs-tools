import { afterAll, describe, expect, test } from "bun:test";

import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { askUser, denyPaths, textOf } from "@better-fs-tools/read";

import { createNodeReadTool, nodeFileSystem } from "../src/index.ts";

const root = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-authorize-")));

await writeFile(join(root, ".env"), "API_KEY=secret\n");
await writeFile(join(root, "notes.txt"), "one\n");
await symlink(".env", join(root, "config"));

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fs() {
  return nodeFileSystem({ cwd: root, allowedRoots: [root] });
}

describe("authorize on the node filesystem", () => {
  test("a symlink config -> .env is denied by its realpath", async () => {
    const targets: string[] = [];
    const read = createNodeReadTool({
      fs: fs(),
      authorize: {
        id: "spy+deny",
        async authorize(target, ctx) {
          targets.push(target.resolvedPath);
          return denyPaths(["**/.env"]).authorize(target, ctx);
        },
      },
    });
    const result = await read({ path: "config" });
    if (result.status !== "error") throw new Error(`expected error, got ${result.status}`);
    expect(result.error.code).toBe("DENIED");
    expect(result.file).toBeNull();
    expect(targets).toEqual([join(root, ".env")]);
    expect(textOf(result)).toBe(
      "[read:denied] config was refused by policy (the path matches a denied pattern).",
    );
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("a file that changes while the user decides gives CHANGED_DURING_READ", async () => {
    const path = join(root, "notes.txt");
    const read = createNodeReadTool({
      fs: fs(),
      authorize: askUser(async () => {
        await writeFile(path, "one\ntwo, written during approval\n");
        return true;
      }),
    });
    const result = await read({ path: "notes.txt" });
    if (result.status !== "error") throw new Error(`expected error, got ${result.status}`);
    expect(result.error.code).toBe("CHANGED_DURING_READ");
  });
});
