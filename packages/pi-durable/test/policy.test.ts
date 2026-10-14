import { describe, expect, test } from "bun:test";

import { mkdir, readFile, symlink } from "node:fs/promises";
import path from "node:path";

import { executionEnvFileSystem } from "../src/index.ts";
import { context, fixtures, localEnv } from "./helpers.ts";

const fixture = fixtures();
const ENCODER = new TextEncoder();
const ANY = { kind: "any" } as const;

async function textOf(fs: ReturnType<typeof executionEnvFileSystem>, file: string) {
  const opened = await fs.open(file, {});
  if (!opened.ok) return `error:${opened.error.reason}`;
  let text = "";
  for await (const chunk of opened.file.bytes()) text += new TextDecoder().decode(chunk);
  await opened.file.close();
  return text;
}

describe("executionEnvFileSystem roots and links", () => {
  test("relative paths resolve against env.cwd; the default root is what you pass", async () => {
    const root = await fixture({ "a.txt": "a\n" });
    const fs = executionEnvFileSystem(localEnv(root), { context, allowedRoots: ["."] });
    expect(fs.cwd).toBe(root);
    expect(fs.allowedRoots).toEqual([root]);
    expect(await textOf(fs, "a.txt")).toBe("a\n");
  });

  test("follows a link inside the roots and refuses one that leaves them", async () => {
    const outer = await fixture({ "secret.txt": "no\n", "work/a.txt": "a\n" });
    const root = path.join(outer, "work");
    await symlink(path.join(root, "a.txt"), path.join(root, "inside.txt"));
    await symlink(path.join(outer, "secret.txt"), path.join(root, "outside.txt"));
    const fs = executionEnvFileSystem(localEnv(root), { context, allowedRoots: ["."] });
    expect(await textOf(fs, "inside.txt")).toBe("a\n");
    expect(await textOf(fs, "outside.txt")).toBe("error:outside-allowed-roots");
    const write = await fs.write("outside.txt", ENCODER.encode("x"), {
      precondition: ANY,
      createParents: false,
    });
    expect(write.ok ? "ok" : write.error.reason).toBe("outside-allowed-roots");
    expect(await readFile(path.join(outer, "secret.txt"), "utf8")).toBe("no\n");
  });

  test('symlinks: "reject" refuses a link anywhere in the path', async () => {
    const root = await fixture({ "real/a.txt": "a\n" });
    await symlink(path.join(root, "real"), path.join(root, "linked"));
    const fs = executionEnvFileSystem(localEnv(root), {
      context,
      allowedRoots: ["."],
      symlinks: "reject",
    });
    expect(await textOf(fs, "real/a.txt")).toBe("a\n");
    expect(await textOf(fs, "linked/a.txt")).toBe("error:denied");
    const stat = await fs.stat("linked/new.txt", {});
    expect(stat.ok ? "ok" : stat.error.reason).toBe("denied");
  });

  test("refuses a write through a dangling link", async () => {
    const outer = await fixture({ "work/a.txt": "a\n" });
    const root = path.join(outer, "work");
    await symlink(path.join(outer, "made.txt"), path.join(root, "dangling.txt"));
    const fs = executionEnvFileSystem(localEnv(root), { context, allowedRoots: ["."] });
    const write = await fs.write("dangling.txt", ENCODER.encode("x"), {
      precondition: ANY,
      createParents: false,
    });
    expect(write.ok ? "ok" : write.error.reason).toBe("denied");
  });

  test("deny roots win inside an allowed root", async () => {
    const root = await fixture({ ".git/config": "x", "a.txt": "a" });
    const fs = executionEnvFileSystem(localEnv(root), {
      context,
      allowedRoots: ["."],
      denyRoots: [".git"],
    });
    expect(await textOf(fs, ".git/config")).toBe("error:dangerous-path");
  });

  test("lists a directory, bounded, with a link as other", async () => {
    const root = await fixture({ "dir/a.txt": "a", "dir/b.txt": "b", "dir/c.txt": "c" });
    await mkdir(path.join(root, "dir", "sub"));
    await symlink(path.join(root, "dir", "a.txt"), path.join(root, "dir", "link"));
    const fs = executionEnvFileSystem(localEnv(root), { context, allowedRoots: ["."] });
    const all = await fs.list("dir", { limit: 10 });
    if (!all.ok) throw new Error(all.error.reason);
    expect(all.truncated).toBe(false);
    expect([...all.entries].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "a.txt", type: "file" },
      { name: "b.txt", type: "file" },
      { name: "c.txt", type: "file" },
      { name: "link", type: "other" },
      { name: "sub", type: "directory" },
    ]);
    const cut = await fs.list("dir", { limit: 2 });
    expect(cut.ok && cut.entries.length === 2 && cut.truncated).toBe(true);
  });

  test("checks its options", async () => {
    const env = localEnv(await fixture());
    expect(() => executionEnvFileSystem(env, { allowedRoots: ["."] } as never)).toThrow(TypeError);
    expect(() => executionEnvFileSystem(env, { context, allowedRoots: [] })).toThrow(TypeError);
    expect(() =>
      executionEnvFileSystem(env, { context, allowedRoots: ["."], identity: "required" as never }),
    ).toThrow(TypeError);
  });
});
