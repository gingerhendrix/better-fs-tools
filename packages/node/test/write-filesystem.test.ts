import { afterAll, describe, expect, test } from "bun:test";

import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ExistingFileStat,
  MutationErrorReason,
  MutationOutcome,
  StageOutcome,
  StatOutcome,
  WriteOptions,
} from "@better-fs-tools/fs";

import { nodeFileSystem } from "../src/index.ts";
import type { NodeFileSystemOptions } from "../src/index.ts";
import { nodeContext } from "../src/policy.ts";
import { mapMutationError, NODE_WRITE_IO, nodeWrites } from "../src/write.ts";
import type { NodeWriteIo } from "../src/write.ts";

const base = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-write-")));
const outside = await realpath(await mkdtemp(join(tmpdir(), "better-fs-tools-node-write-out-")));
await writeFile(join(outside, "secret.txt"), "secret\n");

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

let counter = 0;
/** A fresh directory inside the temp root for each test. */
async function freshRoot(): Promise<string> {
  counter += 1;
  const root = join(base, `case-${counter}`);
  await mkdir(root);
  return root;
}

function fsAt(root: string, options: Partial<NodeFileSystemOptions> = {}) {
  return nodeFileSystem({ cwd: root, allowedRoots: [root], ...options });
}

const encode = (text: string) => new TextEncoder().encode(text);
const ANY = { kind: "any" } as const;
const ABSENT = { kind: "absent" } as const;
const options = (extra: Partial<WriteOptions> = {}): WriteOptions => ({
  precondition: ANY,
  createParents: false,
  ...extra,
});

function expectOk(outcome: MutationOutcome) {
  if (!outcome.ok) throw new Error(`expected ok, got ${JSON.stringify(outcome.error)}`);
  return outcome.file;
}

function expectStaged(outcome: StageOutcome) {
  if (!outcome.ok) throw new Error(`expected a stage, got ${JSON.stringify(outcome.error)}`);
  return outcome.staged;
}

function expectReason(
  outcome: MutationOutcome | StageOutcome | StatOutcome,
  reason: MutationErrorReason,
) {
  if (outcome.ok) throw new Error(`expected ${reason}, got a successful outcome`);
  expect(outcome.error.reason).toBe(reason);
  return outcome.error;
}

async function existing(fs: ReturnType<typeof fsAt>, path: string): Promise<ExistingFileStat> {
  const outcome = await fs.stat(path, {});
  if (!outcome.ok || !outcome.stat.exists) throw new Error(`expected ${path} to exist`);
  return outcome.stat;
}

async function tempFiles(root: string): Promise<string[]> {
  const names = await readdir(root, { recursive: true });
  return names.filter((name) => name.endsWith(".tmp"));
}

const modeOf = async (path: string) => (await stat(path)).mode & 0o7777;

/** Runs with a strict umask, so a mode that ignores it shows. */
async function withUmask<T>(mask: number, run: () => Promise<T>): Promise<T> {
  const previous = process.umask(mask);
  try {
    return await run();
  } finally {
    process.umask(previous);
  }
}

const failWith = (code: string) => async () => {
  throw Object.assign(new Error(code), { code });
};

describe("node stat", () => {
  test("an existing file reports version, mode, and link count", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "a.txt"), "a\n", { mode: 0o640 });
    await chmod(join(root, "a.txt"), 0o640);
    const fs = fsAt(root);
    const file = await existing(fs, "a.txt");
    expect(file).toMatchObject({
      resolvedPath: join(root, "a.txt"),
      displayPath: "a.txt",
      size: 2,
      mode: 0o640,
      hardLinks: 1,
    });
    expect(file.version).toBe(file.identity as string);
    const opened = await fs.open("a.txt", {});
    if (!opened.ok) throw new Error("expected a handle");
    await opened.file.close();
    expect(opened.file.info.version).toBe(file.version);
  });

  test("a missing path resolves through the real path of its nearest ancestor", async () => {
    const root = await freshRoot();
    await mkdir(join(root, "real"));
    await symlink(join(root, "real"), join(root, "alias"));
    const outcome = await fsAt(root).stat("alias/new/deeper/x.txt", {});
    if (!outcome.ok || outcome.stat.exists) throw new Error("expected a missing stat");
    expect(outcome.stat.resolvedPath).toBe(join(root, "real", "new", "deeper", "x.txt"));
    expect(outcome.stat.displayPath).toBe(join("real", "new", "deeper", "x.txt"));
    expect(outcome.stat.missingDirectories).toEqual([
      join(root, "real", "new"),
      join(root, "real", "new", "deeper"),
    ]);
  });

  test("a file as an ancestor gives not-found", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "file.txt"), "x\n");
    expectReason(await fsAt(root).stat("file.txt/x.txt", {}), "not-found");
  });

  test("symlinks reject refuses a link to a missing path", async () => {
    const root = await freshRoot();
    await mkdir(join(root, "real"));
    await symlink(join(root, "real"), join(root, "alias"));
    const error = expectReason(
      await fsAt(root, { symlinks: "reject" }).stat("alias/x.txt", {}),
      "denied",
    );
    expect(error.detail).toContain("policy rejects symlinks");
  });

  test("an aborted signal gives aborted before any lookup", async () => {
    const root = await freshRoot();
    expectReason(await fsAt(root).stat("x.txt", { signal: AbortSignal.abort() }), "aborted");
  });
});

describe("node write: replace and create", () => {
  test("a replace keeps the mode, and a new file gets 0o666 without the umask (Q5)", async () => {
    const root = await freshRoot();
    const fs = fsAt(root);
    await writeFile(join(root, "kept.txt"), "old\n");
    await chmod(join(root, "kept.txt"), 0o640);
    await withUmask(0o077, async () => {
      const before = await existing(fs, "kept.txt");
      expectOk(
        await fs.write(
          "kept.txt",
          encode("new\n"),
          options({ precondition: { kind: "version", version: before.version }, mode: 0o600 }),
        ),
      );
      expectOk(await fs.write("new.txt", encode("new\n"), options({ precondition: ABSENT })));
    });
    expect(await modeOf(join(root, "kept.txt"))).toBe(0o640);
    expect(await readFile(join(root, "kept.txt"), "utf8")).toBe("new\n");
    expect(await modeOf(join(root, "new.txt"))).toBe(0o600);
    // The umask is read at each create, not when the filesystem is built.
    await withUmask(0o002, async () =>
      expectOk(await fs.write("shared.txt", encode("x\n"), options({ precondition: ABSENT }))),
    );
    expect(await modeOf(join(root, "shared.txt"))).toBe(0o664);
  });

  test("an explicit newFileMode is exact: the umask does not apply to it", async () => {
    const root = await freshRoot();
    const fs = fsAt(root, { newFileMode: 0o644, newDirectoryMode: 0o755 });
    await withUmask(0o077, async () =>
      expectOk(
        await fs.write(
          "d/a.txt",
          encode("a\n"),
          options({ precondition: ABSENT, createParents: true }),
        ),
      ),
    );
    expect(await modeOf(join(root, "d"))).toBe(0o755);
    expect(await modeOf(join(root, "d", "a.txt"))).toBe(0o644);
  });

  test("newFileMode and options.mode set the mode of a new file", async () => {
    const root = await freshRoot();
    const fs = fsAt(root, { newFileMode: 0o600 });
    expectOk(await fs.write("a.txt", encode("a\n"), options({ precondition: ABSENT })));
    expectOk(
      await fs.write("b.txt", encode("b\n"), options({ precondition: ABSENT, mode: 0o755 })),
    );
    expect(await modeOf(join(root, "a.txt"))).toBe(0o600);
    expect(await modeOf(join(root, "b.txt"))).toBe(0o755);
  });

  test("a mode out of range is refused before anything changes", async () => {
    const root = await freshRoot();
    const outcome = await fsAt(root).write("a.txt", encode("a\n"), options({ mode: 0o10000 }));
    expectReason(outcome, "denied");
    expect(await readdir(root)).toEqual([]);
  });

  test("the outcome reports the version open() sees, and atomic true", async () => {
    const root = await freshRoot();
    const fs = fsAt(root);
    const file = expectOk(
      await fs.write("a.txt", encode("abc\n"), options({ precondition: ABSENT })),
    );
    expect(file).toMatchObject({
      resolvedPath: join(root, "a.txt"),
      displayPath: "a.txt",
      size: 4,
      createdDirectories: [],
      atomic: true,
    });
    expect(file.version).toBe((await existing(fs, "a.txt")).version);
    expect(file.identity).toBe(file.version);
  });

  test("any creates a missing file", async () => {
    const root = await freshRoot();
    expectOk(await fsAt(root).write("a.txt", encode("a\n"), options()));
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("a\n");
  });

  test("a version precondition on a missing file gives changed", async () => {
    const root = await freshRoot();
    const outcome = await fsAt(root).write(
      "a.txt",
      encode("a\n"),
      options({ precondition: { kind: "version", version: "1:2:3:4:5" } }),
    );
    expectReason(outcome, "changed");
  });

  test("an aborted signal gives aborted and writes nothing", async () => {
    const root = await freshRoot();
    const outcome = await fsAt(root).write(
      "a.txt",
      encode("a\n"),
      options({ signal: AbortSignal.abort() }),
    );
    expectReason(outcome, "aborted");
    expect(await readdir(root)).toEqual([]);
  });
});

describe("node write: races", () => {
  test("a write on disk between stage and publish gives changed", async () => {
    const root = await freshRoot();
    const fs = fsAt(root);
    await writeFile(join(root, "a.txt"), "one\n");
    const before = await existing(fs, "a.txt");
    const staged = expectStaged(
      await fs.stage(
        "a.txt",
        encode("mine\n"),
        options({ precondition: { kind: "version", version: before.version } }),
      ),
    );
    await writeFile(join(root, "a.txt"), "theirs, longer\n");
    expectReason(await staged.publish(), "changed");
    await staged.discard();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("theirs, longer\n");
    expect(await tempFiles(root)).toEqual([]);
  });

  test("two staged creates: the second publish gives exists through link()", async () => {
    const root = await freshRoot();
    const first = expectStaged(
      await fsAt(root).stage("a.txt", encode("first\n"), options({ precondition: ABSENT })),
    );
    const second = expectStaged(
      await fsAt(root).stage("a.txt", encode("second\n"), options({ precondition: ABSENT })),
    );
    expectOk(await first.publish());
    expectReason(await second.publish(), "exists");
    await second.discard();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("first\n");
    expect(await tempFiles(root)).toEqual([]);
  });

  test("two concurrent absent writes: one wins, one gets exists", async () => {
    const root = await freshRoot();
    const outcomes = await Promise.all(
      ["one\n", "two\n"].map((text) =>
        fsAt(root).write("a.txt", encode(text), options({ precondition: ABSENT })),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    const failed = outcomes.find((outcome) => !outcome.ok);
    expectReason(failed as MutationOutcome, "exists");
    expect(["one\n", "two\n"]).toContain(await readFile(join(root, "a.txt"), "utf8"));
    expect(await tempFiles(root)).toEqual([]);
  });

  test("a directory put in place of the target between stage and publish is refused", async () => {
    const root = await freshRoot();
    const staged = expectStaged(await fsAt(root).stage("a.txt", encode("x\n"), options()));
    await mkdir(join(root, "a.txt"));
    expectReason(await staged.publish(), "not-a-file");
    expect(await tempFiles(root)).toEqual([]);
  });

  test("publish is single-use and discard is idempotent", async () => {
    const root = await freshRoot();
    const staged = expectStaged(await fsAt(root).stage("a.txt", encode("x\n"), options()));
    expect(staged.resolvedPath).toBe(join(root, "a.txt"));
    expectOk(await staged.publish());
    await expect(staged.publish()).rejects.toThrow(TypeError);
    await staged.discard();
    await staged.discard();
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("x\n");
  });

  test("discard removes the temp file and the directories stage created", async () => {
    const root = await freshRoot();
    const staged = expectStaged(
      await fsAt(root).stage("new/deeper/a.txt", encode("x\n"), options({ createParents: true })),
    );
    expect(await tempFiles(root)).toHaveLength(1);
    await staged.discard();
    expect(await readdir(root)).toEqual([]);
  });
});

describe("node write: cleanup after a failure", () => {
  const writesWith = (root: string, io: Partial<NodeWriteIo>) =>
    nodeWrites(nodeContext({ cwd: root, allowedRoots: [root] }), { ...NODE_WRITE_IO, ...io });

  test("a rename failure removes the temp file and keeps the target", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "a.txt"), "old\n");
    const writes = writesWith(root, { rename: failWith("ENOSPC") });
    const error = expectReason(await writes.write("a.txt", encode("new\n"), options()), "no-space");
    expect(error.cause).toEqual({ code: "ENOSPC", phase: "publish" });
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("old\n");
    expect(await tempFiles(root)).toEqual([]);
  });

  test("a link failure removes the temp file and the created directories", async () => {
    const root = await freshRoot();
    const writes = writesWith(root, { link: failWith("EROFS") });
    const outcome = await writes.write(
      "new/a.txt",
      encode("x\n"),
      options({ precondition: ABSENT, createParents: true }),
    );
    expectReason(outcome, "read-only");
    expect(await readdir(root)).toEqual([]);
  });

  test("a temp file open failure maps EROFS to read-only", async () => {
    const root = await freshRoot();
    const writes = writesWith(root, { open: failWith("EROFS") });
    expectReason(await writes.write("a.txt", encode("x\n"), options()), "read-only");
    expect(await readdir(root)).toEqual([]);
  });

  test("a mkdir failure removes the directories made before it", async () => {
    const root = await freshRoot();
    let calls = 0;
    const writes = writesWith(root, {
      mkdir: (async (...args: Parameters<typeof NODE_WRITE_IO.mkdir>) => {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error("EDQUOT"), { code: "EDQUOT" });
        return NODE_WRITE_IO.mkdir(...args);
      }) as NodeWriteIo["mkdir"],
    });
    const outcome = await writes.write(
      "one/two/a.txt",
      encode("x\n"),
      options({ createParents: true }),
    );
    expectReason(outcome, "no-space");
    expect(await readdir(root)).toEqual([]);
  });

  test("mapMutationError maps EROFS, ENOSPC, EDQUOT, and EEXIST, and defers the rest", () => {
    const error = (code: string) => Object.assign(new Error(code), { code });
    expect(mapMutationError(error("EROFS"), "publish").reason).toBe("read-only");
    expect(mapMutationError(error("ENOSPC"), "publish").reason).toBe("no-space");
    expect(mapMutationError(error("EDQUOT"), "publish").reason).toBe("no-space");
    expect(mapMutationError(error("EEXIST"), "publish")).toEqual({
      reason: "exists",
      cause: { code: "EEXIST", phase: "publish" },
    });
    expect(mapMutationError(error("EACCES"), "stage").reason).toBe("permission-denied");
    expect(mapMutationError(error("EIO"), "stage").reason).toBe("io");
  });
});

describe("node write: symbolic links", () => {
  test("a link inside the roots: the target changes and the link stays", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "real.txt"), "old\n");
    await symlink("real.txt", join(root, "link.txt"));
    const fs = fsAt(root);
    const before = await existing(fs, "link.txt");
    expect(before.resolvedPath).toBe(join(root, "real.txt"));
    const file = expectOk(
      await fs.write(
        "link.txt",
        encode("new\n"),
        options({ precondition: { kind: "version", version: before.version } }),
      ),
    );
    expect(file.resolvedPath).toBe(join(root, "real.txt"));
    expect(await readFile(join(root, "real.txt"), "utf8")).toBe("new\n");
    expect((await lstat(join(root, "link.txt"))).isSymbolicLink()).toBe(true);
  });

  test("a link out of the roots is refused and the outside file is kept", async () => {
    const root = await freshRoot();
    await symlink(join(outside, "secret.txt"), join(root, "out.txt"));
    const fs = fsAt(root);
    expectReason(await fs.write("out.txt", encode("x\n"), options()), "outside-allowed-roots");
    expectReason(await fs.stat("out.txt", {}), "outside-allowed-roots");
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret\n");
  });

  test("a dangling link is refused and its target is not created", async () => {
    const root = await freshRoot();
    await symlink("missing.txt", join(root, "dangling.txt"));
    const fs = fsAt(root);
    const error = expectReason(await fs.write("dangling.txt", encode("x\n"), options()), "denied");
    expect(error.detail).toContain("symbolic link");
    expectReason(await fs.stat("dangling.txt", {}), "denied");
    expect((await readdir(root)).sort()).toEqual(["dangling.txt"]);
  });

  test("symlinks reject refuses a write through a link", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "real.txt"), "old\n");
    await symlink("real.txt", join(root, "link.txt"));
    expectReason(
      await fsAt(root, { symlinks: "reject" }).write("link.txt", encode("x\n"), options()),
      "denied",
    );
    expect(await readFile(join(root, "real.txt"), "utf8")).toBe("old\n");
  });
});

describe("node write: hard links", () => {
  test("a hard-linked file is refused by default", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "a.txt"), "old\n");
    await link(join(root, "a.txt"), join(root, "b.txt"));
    const fs = fsAt(root);
    expect((await existing(fs, "a.txt")).hardLinks).toBe(2);
    const error = expectReason(await fs.write("a.txt", encode("new\n"), options()), "denied");
    expect(error.detail).toBe("the file has more than one hard link");
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("old\n");
    expect(await tempFiles(root)).toEqual([]);
  });

  test('"in-place" writes through both names with atomic false', async () => {
    const root = await freshRoot();
    await writeFile(join(root, "a.txt"), "old, longer text\n");
    await chmod(join(root, "a.txt"), 0o640);
    await link(join(root, "a.txt"), join(root, "b.txt"));
    const fs = fsAt(root, { hardLinks: "in-place" });
    const before = await existing(fs, "a.txt");
    const file = expectOk(
      await fs.write(
        "a.txt",
        encode("new\n"),
        options({ precondition: { kind: "version", version: before.version } }),
      ),
    );
    expect(file.atomic).toBe(false);
    expect(file.size).toBe(4);
    expect(file.version).toBe((await existing(fs, "a.txt")).version);
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("new\n");
    expect((await stat(join(root, "a.txt"))).ino).toBe((await stat(join(root, "b.txt"))).ino);
    expect(await modeOf(join(root, "a.txt"))).toBe(0o640);
    expect(await tempFiles(root)).toEqual([]);
  });

  test('"in-place" checks the version under the lock', async () => {
    const root = await freshRoot();
    await writeFile(join(root, "a.txt"), "old\n");
    await link(join(root, "a.txt"), join(root, "b.txt"));
    const fs = fsAt(root, { hardLinks: "in-place" });
    const before = await existing(fs, "a.txt");
    const staged = expectStaged(
      await fs.stage(
        "a.txt",
        encode("mine\n"),
        options({ precondition: { kind: "version", version: before.version } }),
      ),
    );
    await writeFile(join(root, "b.txt"), "theirs, longer\n");
    expectReason(await staged.publish(), "changed");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("theirs, longer\n");
  });
});

describe("node write: special files and parents", () => {
  test("a FIFO target is refused without blocking", async () => {
    const root = await freshRoot();
    const made = spawnSync("mkfifo", [join(root, "pipe")]);
    if (made.status !== 0) return; // mkfifo unavailable: nothing to assert
    const fs = fsAt(root);
    const started = Date.now();
    const outcome = (await Promise.race([
      fs.write("pipe", encode("x\n"), options()),
      new Promise((resolve) => setTimeout(() => resolve(null), 2_000)),
    ])) as MutationOutcome | null;
    if (outcome === null) throw new Error("the write blocked on a FIFO");
    const error = expectReason(outcome, "not-a-file");
    if (error.reason !== "not-a-file") throw new Error("unreachable");
    expect(error.kind).toBe("fifo");
    expect(Date.now() - started).toBeLessThan(2_000);
    expectReason(await fs.stat("pipe", {}), "not-a-file");
    expect(await tempFiles(root)).toEqual([]);
  });

  test("a directory target is refused", async () => {
    const root = await freshRoot();
    await mkdir(join(root, "dir"));
    expectReason(await fsAt(root).write("dir", encode("x\n"), options()), "not-a-file");
  });

  test("createParents creates 0o777 directories without the umask (Q5)", async () => {
    const root = await freshRoot();
    const file = await withUmask(0o077, async () =>
      expectOk(
        await fsAt(root).write("one/two/a.txt", encode("x\n"), options({ createParents: true })),
      ),
    );
    expect(file.createdDirectories).toEqual([join(root, "one"), join(root, "one", "two")]);
    expect(await modeOf(join(root, "one"))).toBe(0o700);
    expect(await modeOf(join(root, "one", "two"))).toBe(0o700);
    expect(await readFile(join(root, "one", "two", "a.txt"), "utf8")).toBe("x\n");
  });

  test("a missing parent without createParents gives not-found", async () => {
    const root = await freshRoot();
    expectReason(await fsAt(root).write("one/a.txt", encode("x\n"), options()), "not-found");
    expect(await readdir(root)).toEqual([]);
  });

  test("parents are created inside the roots only", async () => {
    const root = await freshRoot();
    await symlink(outside, join(root, "out"));
    const fs = fsAt(root);
    const createParents = options({ createParents: true });
    expectReason(
      await fs.write("out/new/a.txt", encode("x\n"), createParents),
      "outside-allowed-roots",
    );
    expectReason(
      await fs.write(join(outside, "new", "a.txt"), encode("x\n"), createParents),
      "outside-allowed-roots",
    );
    expectReason(
      await fs.write("../escape/a.txt", encode("x\n"), createParents),
      "outside-allowed-roots",
    );
    expect((await readdir(outside)).sort()).toEqual(["secret.txt"]);
  });

  test("a deny root refuses a write below it before any directory is made", async () => {
    const root = await freshRoot();
    const fs = fsAt(root, { denyRoots: [join(root, "private")] });
    expectReason(
      await fs.write("private/new/a.txt", encode("x\n"), options({ createParents: true })),
      "dangerous-path",
    );
    expect(await readdir(root)).toEqual([]);
  });

  test("a write to /dev is refused as dangerous-path", async () => {
    const root = await freshRoot();
    expectReason(await fsAt(root).write("/dev/null", encode("x\n"), options()), "dangerous-path");
  });
});

describe("node remove", () => {
  test("removes a file under its version, and a stale version gives changed", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "a.txt"), "one\n");
    const fs = fsAt(root);
    const stale = (await existing(fs, "a.txt")).version;
    await writeFile(join(root, "a.txt"), "two, longer\n");
    expectReason(
      await fs.remove("a.txt", { precondition: { kind: "version", version: stale } }),
      "changed",
    );
    const current = (await existing(fs, "a.txt")).version;
    const file = expectOk(
      await fs.remove("a.txt", { precondition: { kind: "version", version: current } }),
    );
    expect(file).toMatchObject({ resolvedPath: join(root, "a.txt"), version: null, size: null });
    expect(await readdir(root)).toEqual([]);
  });

  test("a missing file gives not-found, or changed under a version", async () => {
    const root = await freshRoot();
    const fs = fsAt(root);
    expectReason(await fs.remove("a.txt", { precondition: ANY }), "not-found");
    expectReason(
      await fs.remove("a.txt", { precondition: { kind: "version", version: "1:2:3:4:5" } }),
      "changed",
    );
  });

  test("a directory and a link out of the roots are refused", async () => {
    const root = await freshRoot();
    await mkdir(join(root, "dir"));
    await symlink(join(outside, "secret.txt"), join(root, "out.txt"));
    const fs = fsAt(root);
    expectReason(await fs.remove("dir", { precondition: ANY }), "not-a-file");
    expectReason(await fs.remove("out.txt", { precondition: ANY }), "outside-allowed-roots");
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("secret\n");
  });

  test("removing through a link inside the roots removes the real file", async () => {
    const root = await freshRoot();
    await writeFile(join(root, "real.txt"), "x\n");
    await symlink("real.txt", join(root, "link.txt"));
    expectOk(await fsAt(root).remove("link.txt", { precondition: ANY }));
    expect((await readdir(root)).sort()).toEqual(["link.txt"]);
  });
});
