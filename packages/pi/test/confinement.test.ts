import { describe, expect, test } from "bun:test";

import { spawnSync } from "node:child_process";
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { createPiReadTool } from "../src/index.ts";
import { execute, fixture, textOf } from "./helpers.ts";

describe("pi working directory confinement", () => {
  test("binds every call to that call's ctx.cwd", async () => {
    const parent = await fixture({
      "first/same.txt": "first root",
      "second/same.txt": "second root",
      "secret.txt": "outside",
    });
    const first = path.join(parent, "first");
    const second = path.join(parent, "second");
    const tool = createPiReadTool();

    expect(textOf(await execute(tool, { path: "same.txt" }, first))).toBe("1|first root");
    // The cwd changes between calls on the same tool, and the root follows it.
    expect(textOf(await execute(tool, { path: "same.txt" }, second))).toBe("1|second root");
    expect(textOf(await execute(tool, { path: path.join(first, "same.txt") }, first))).toBe(
      "1|first root",
    );
    expect(textOf(await execute(tool, { path: path.join(first, "same.txt") }, second))).toMatch(
      /^\[read:outside-allowed-roots\]/u,
    );
    // Back to the first root: the cache is keyed by directory, not by recency.
    expect(textOf(await execute(tool, { path: "same.txt" }, first))).toBe("1|first root");

    for (const escape of ["../secret.txt", path.join(parent, "secret.txt")]) {
      expect(textOf(await execute(tool, { path: escape }, first))).toMatch(
        /^\[read:outside-allowed-roots\]/u,
      );
    }
    expect(textOf(await execute(tool, { path: "/proc/self/status" }, "/"))).toMatch(
      /^\[read:dangerous-path\]/u,
    );
  });

  test("refuses a symlink that escapes ctx.cwd", async () => {
    const parent = await fixture({ "inside/keep.txt": "inside", "secret.txt": "outside" });
    const inside = path.join(parent, "inside");
    await symlink(path.join(parent, "secret.txt"), path.join(inside, "escape.txt"));
    const tool = createPiReadTool();

    expect(textOf(await execute(tool, { path: "keep.txt" }, inside))).toBe("1|inside");
    expect(textOf(await execute(tool, { path: "escape.txt" }, inside))).toMatch(
      /^\[read:outside-allowed-roots\]/u,
    );
  });

  test("honours extra deny roots and a reject-symlinks policy", async () => {
    const root = await fixture({ "open.txt": "open", "closed/secret.txt": "closed" });
    await symlink(path.join(root, "open.txt"), path.join(root, "link.txt"));

    const denied = createPiReadTool({ denyRoots: [path.join(root, "closed")] });
    expect(textOf(await execute(denied, { path: "open.txt" }, root))).toBe("1|open");
    expect(textOf(await execute(denied, { path: "closed/secret.txt" }, root))).toMatch(
      /^\[read:dangerous-path\]/u,
    );

    const rejecting = createPiReadTool({ symlinks: "reject" });
    expect(textOf(await execute(rejecting, { path: "link.txt" }, root))).toMatch(
      /^\[read:denied\]/u,
    );
    expect(textOf(await execute(createPiReadTool(), { path: "link.txt" }, root))).toBe("1|open");
  });

  test("refuses a directory and a FIFO instead of hanging on them", async () => {
    const root = await fixture({ "dir/file.txt": "nested" });
    const tool = createPiReadTool();

    expect(textOf(await execute(tool, { path: "dir" }, root))).toMatch(/^\[read:not-a-file\]/u);

    const fifo = path.join(root, "pipe");
    if (spawnSync("mkfifo", [fifo]).status !== 0) return;
    const result = await Promise.race([
      execute(tool, { path: "pipe" }, root),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("the FIFO read hung")), 2_000),
      ),
    ]);
    expect(textOf(result)).toMatch(/^\[read:not-a-file\]/u);
  });
});

describe("pi root cache", () => {
  test("reuses one filesystem for each resolved working directory", async () => {
    // The cached filesystem resolved its root once. Repointing the symlink the
    // caller passes as ctx.cwd changes nothing for the cached root, while a
    // fresh tool follows the link to the new directory. That difference shows
    // the reuse.
    const parent = await fixture({ "one/a.txt": "one", "two/a.txt": "two" });
    const link = path.join(parent, "cwd");
    await symlink(path.join(parent, "one"), link);
    const tool = createPiReadTool();

    expect(textOf(await execute(tool, { path: "a.txt" }, link))).toBe("1|one");
    await unlink(link);
    await symlink(path.join(parent, "two"), link);

    expect(textOf(await execute(tool, { path: "a.txt" }, link))).toMatch(
      /^\[read:outside-allowed-roots\]/u,
    );
    expect(textOf(await execute(createPiReadTool(), { path: "a.txt" }, link))).toBe("1|two");
  });

  test("stays correct past the cache bound", async () => {
    const roots: string[] = [];
    const parent = await fixture();
    for (let index = 0; index < 12; index += 1) {
      const root = path.join(parent, `root-${index}`);
      await mkdir(root);
      await writeFile(path.join(root, "a.txt"), `root ${index}`);
      roots.push(root);
    }
    const tool = createPiReadTool();

    for (const [index, root] of roots.entries()) {
      expect(textOf(await execute(tool, { path: "a.txt" }, root))).toBe(`1|root ${index}`);
    }
    // Evicted roots are rebuilt, not lost, and stay confined to themselves.
    expect(textOf(await execute(tool, { path: "a.txt" }, roots[0] as string))).toBe("1|root 0");
    expect(textOf(await execute(tool, { path: "../root-1/a.txt" }, roots[0] as string))).toMatch(
      /^\[read:outside-allowed-roots\]/u,
    );
  });

  test("treats equivalent spellings of one directory as one root", async () => {
    const root = await fixture({ "a.txt": "same" });
    const tool = createPiReadTool();

    for (const spelling of [root, `${root}/`, path.join(root, "."), `${root}/sub/..`]) {
      expect(textOf(await execute(tool, { path: "a.txt" }, spelling))).toBe("1|same");
    }
  });
});
