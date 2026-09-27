import { describe, expect, test } from "bun:test";

import { isWritableFileSystem, memoryFileSystem } from "../src/index.ts";
import type {
  FileSystem,
  MemoryFileSystem,
  MutatedFile,
  MutationError,
  MutationOutcome,
  StagedWrite,
  StageOutcome,
  StatOutcome,
} from "../src/index.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const bytes = (text: string) => ENCODER.encode(text);
const ANY = { kind: "any" } as const;
const ABSENT = { kind: "absent" } as const;

function fileOf(outcome: MutationOutcome): MutatedFile {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.reason}`);
  return outcome.file;
}

function errorOf(outcome: MutationOutcome | StageOutcome | StatOutcome): MutationError {
  if (outcome.ok) throw new Error("expected an error outcome");
  return outcome.error;
}

function stagedOf(outcome: StageOutcome): StagedWrite {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error.reason}`);
  return outcome.staged;
}

function textOf(fs: MemoryFileSystem, path: string): string | null {
  const peeked = fs.peek(path);
  return peeked === null ? null : DECODER.decode(peeked.bytes);
}

function versionOf(fs: MemoryFileSystem, path: string): string {
  const peeked = fs.peek(path);
  if (peeked === null) throw new Error(`${path} is missing`);
  return peeked.version;
}

async function names(fs: MemoryFileSystem, path: string): Promise<string[]> {
  const listed = await fs.list?.(path, { limit: 100 });
  if (listed === undefined || !listed.ok) throw new Error("expected a listing");
  return listed.entries.map((entry) => entry.name).sort();
}

describe("memoryFileSystem stat", () => {
  test("an existing file reports the version open() reports", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const stat = await fs.stat("a.txt", {});
    const opened = await fs.open("/a.txt", {});
    if (!opened.ok) throw new Error("expected ok");
    expect(stat).toEqual({
      ok: true,
      stat: {
        exists: true,
        resolvedPath: "/a.txt",
        displayPath: "/a.txt",
        size: 3,
        mtimeMs: null,
        identity: "memory:/a.txt:1",
        version: "memory:/a.txt:1",
        mode: 0o644,
        hardLinks: 1,
      },
    });
    if (!stat.ok || !stat.stat.exists) throw new Error("expected an existing file");
    expect(opened.file.info.version).toBe(stat.stat.version);
  });

  test("without identity the stat has no identity but keeps a version", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" }, identity: false });
    const stat = await fs.stat("/a.txt", {});
    if (!stat.ok || !stat.stat.exists) throw new Error("expected an existing file");
    expect(stat.stat.identity).toBeNull();
    expect(stat.stat.version).toBe("memory:/a.txt:1");
  });

  test("a missing file reports its missing parents, outermost first", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    expect(await fs.stat("/b.txt", {})).toEqual({
      ok: true,
      stat: {
        exists: false,
        resolvedPath: "/b.txt",
        displayPath: "/b.txt",
        missingDirectories: [],
      },
    });
    const deep = await fs.stat("/x/y/z.txt", {});
    expect(deep.ok && !deep.stat.exists && deep.stat.missingDirectories).toEqual(["/x", "/x/y"]);
  });

  test("refusals: directory, file parent, deny root, abort", async () => {
    const fs = memoryFileSystem({
      files: { "/a.txt": "one" },
      directories: ["/dir"],
      denyRoots: ["/secret"],
    });
    expect(errorOf(await fs.stat("/dir", {}))).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/dir", displayPath: "/dir" },
    });
    expect(errorOf(await fs.stat("/a.txt/b", {})).reason).toBe("not-found");
    expect(errorOf(await fs.stat("/secret/k", {})).reason).toBe("dangerous-path");
    expect(errorOf(await fs.stat("/a.txt", { signal: AbortSignal.abort() })).reason).toBe(
      "aborted",
    );
  });
});

describe("memoryFileSystem write", () => {
  test("absent creates a file with the default mode", async () => {
    const fs = memoryFileSystem();
    const file = fileOf(
      await fs.write("/a.txt", bytes("new"), { precondition: ABSENT, createParents: false }),
    );
    expect(file).toEqual({
      resolvedPath: "/a.txt",
      displayPath: "/a.txt",
      version: versionOf(fs, "/a.txt"),
      identity: versionOf(fs, "/a.txt"),
      size: 3,
      createdDirectories: [],
      atomic: true,
    });
    expect(textOf(fs, "/a.txt")).toBe("new");
    expect(fs.peek("/a.txt")?.mode).toBe(0o644);
  });

  test("a new file takes options.mode", async () => {
    const fs = memoryFileSystem();
    await fs.write("/run.sh", bytes("#!/bin/sh\n"), {
      precondition: ABSENT,
      createParents: false,
      mode: 0o755,
    });
    expect(fs.peek("/run.sh")?.mode).toBe(0o755);
  });

  test("two absent writes: the second gives exists", async () => {
    const fs = memoryFileSystem();
    const options = { precondition: ABSENT, createParents: false };
    const [first, second] = await Promise.all([
      fs.write("/a.txt", bytes("first"), options),
      fs.write("/a.txt", bytes("second"), options),
    ]);
    expect(first.ok).toBe(true);
    expect(errorOf(second)).toEqual({ reason: "exists" });
    expect(textOf(fs, "/a.txt")).toBe("first");
  });

  test("a stale version gives changed and keeps the bytes", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const stat = await fs.stat("/a.txt", {});
    if (!stat.ok || !stat.stat.exists) throw new Error("expected an existing file");
    // A concurrent writer between stat and write.
    fs.setFile("/a.txt", "other");
    const outcome = await fs.write("/a.txt", bytes("mine"), {
      precondition: { kind: "version", version: stat.stat.version },
      createParents: false,
    });
    expect(errorOf(outcome)).toEqual({ reason: "changed" });
    expect(textOf(fs, "/a.txt")).toBe("other");
  });

  test("a version precondition on a missing file gives changed", async () => {
    const fs = memoryFileSystem();
    const outcome = await fs.write("/a.txt", bytes("x"), {
      precondition: { kind: "version", version: "memory:/a.txt:1" },
      createParents: false,
    });
    expect(errorOf(outcome).reason).toBe("changed");
  });

  test("the current version replaces, changes the version, and keeps the mode", async () => {
    const fs = memoryFileSystem();
    fs.setFile("/a.sh", "one", { mode: 0o755 });
    const before = versionOf(fs, "/a.sh");
    const file = fileOf(
      await fs.write("/a.sh", bytes("two"), {
        precondition: { kind: "version", version: before },
        createParents: false,
        mode: 0o600,
      }),
    );
    expect(file.version).not.toBe(before);
    expect(file.version).toBe(versionOf(fs, "/a.sh"));
    expect(fs.peek("/a.sh")?.mode).toBe(0o755);
    expect(textOf(fs, "/a.sh")).toBe("two");
  });

  test("preserveMode: false gives a replaced file the new-file mode", async () => {
    const fs = memoryFileSystem({ writeCapabilities: { preserveMode: false } });
    fs.setFile("/a.sh", "one", { mode: 0o755 });
    await fs.write("/a.sh", bytes("two"), { precondition: ANY, createParents: false });
    expect(fs.peek("/a.sh")?.mode).toBe(0o644);
    expect(fs.writeCapabilities).toEqual({
      atomic: true,
      compareAndSwap: true,
      preserveMode: false,
    });
  });

  test("any replaces without a check", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    fileOf(await fs.write("/a.txt", bytes("two"), { precondition: ANY, createParents: false }));
    expect(textOf(fs, "/a.txt")).toBe("two");
  });

  test("the written bytes are copied", async () => {
    const fs = memoryFileSystem();
    const input = bytes("abc");
    await fs.write("/a.txt", input, { precondition: ANY, createParents: false });
    input[0] = 0x7a;
    expect(textOf(fs, "/a.txt")).toBe("abc");
  });

  test("a missing parent is refused without createParents", async () => {
    const fs = memoryFileSystem();
    const outcome = await fs.write("/x/y/a.txt", bytes("x"), {
      precondition: ABSENT,
      createParents: false,
    });
    expect(errorOf(outcome).reason).toBe("not-found");
    expect(await names(fs, "/")).toEqual([]);
  });

  test("createParents creates and reports the directories", async () => {
    const fs = memoryFileSystem({ directories: ["/x"] });
    const file = fileOf(
      await fs.write("/x/y/z/a.txt", bytes("x"), { precondition: ABSENT, createParents: true }),
    );
    expect(file.createdDirectories).toEqual(["/x/y", "/x/y/z"]);
    expect(await names(fs, "/x/y")).toEqual(["z"]);
    expect(await names(fs, "/x/y/z")).toEqual(["a.txt"]);
  });

  test("a file parent is refused", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const outcome = await fs.write("/a.txt/b", bytes("x"), {
      precondition: ANY,
      createParents: true,
    });
    expect(errorOf(outcome).reason).toBe("not-found");
  });

  test("a directory target is not-a-file before the precondition", async () => {
    const fs = memoryFileSystem({ directories: ["/dir"] });
    const outcome = await fs.write("/dir", bytes("x"), {
      precondition: ABSENT,
      createParents: false,
    });
    expect(errorOf(outcome)).toEqual({
      reason: "not-a-file",
      kind: "directory",
      target: { resolvedPath: "/dir", displayPath: "/dir" },
    });
  });

  test("policy, abort, and size refusals", async () => {
    const fs = memoryFileSystem({ denyRoots: ["/secret"], maxBufferedBytes: 4 });
    const options = { precondition: ANY, createParents: true };
    expect(errorOf(await fs.write("/secret/a", bytes("x"), options)).reason).toBe("dangerous-path");
    expect(
      errorOf(await fs.write("/a", bytes("x"), { ...options, signal: AbortSignal.abort() })).reason,
    ).toBe("aborted");
    expect(errorOf(await fs.write("/a", bytes("12345"), options)).reason).toBe("no-space");
    expect(fs.peek("/a")).toBeNull();
  });

  test("readOnly refuses every mutation and still reads", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" }, readOnly: true });
    const options = { precondition: ANY, createParents: false };
    expect(errorOf(await fs.write("/a.txt", bytes("x"), options))).toEqual({ reason: "read-only" });
    expect(errorOf(await fs.write("/b.txt", bytes("x"), options)).reason).toBe("read-only");
    expect(errorOf((await fs.stage?.("/a.txt", bytes("x"), options)) as StageOutcome).reason).toBe(
      "read-only",
    );
    expect(
      errorOf((await fs.remove?.("/a.txt", { precondition: ANY })) as MutationOutcome),
    ).toEqual({ reason: "read-only" });
    expect((await fs.stat("/a.txt", {})).ok).toBe(true);
    expect(textOf(fs, "/a.txt")).toBe("one");
  });

  test("a fault fails the write with its error after the other checks", async () => {
    const calls: string[] = [];
    const fs = memoryFileSystem({
      files: { "/a.txt": "one" },
      faults: (operation, path) => {
        calls.push(`${operation} ${path}`);
        return { reason: "no-space", detail: "disk full" };
      },
    });
    const outcome = await fs.write("a.txt", bytes("two"), {
      precondition: ANY,
      createParents: false,
    });
    expect(errorOf(outcome)).toEqual({ reason: "no-space", detail: "disk full" });
    expect(calls).toEqual(["write /a.txt"]);
    // A failed precondition never reaches the fault hook.
    await fs.write("/a.txt", bytes("two"), { precondition: ABSENT, createParents: false });
    expect(calls).toEqual(["write /a.txt"]);
    expect(textOf(fs, "/a.txt")).toBe("one");
  });

  test("an open handle sees a write through verify()", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const opened = await fs.open("/a.txt", {});
    if (!opened.ok) throw new Error("expected ok");
    await fs.write("/a.txt", bytes("two"), { precondition: ANY, createParents: false });
    expect(await opened.file.verify()).toEqual({ ok: true, changed: true });
  });
});

describe("memoryFileSystem remove", () => {
  test("the current version removes the file", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const file = fileOf(
      await fs.remove!("/a.txt", {
        precondition: { kind: "version", version: versionOf(fs, "/a.txt") },
      }),
    );
    expect(file).toEqual({
      resolvedPath: "/a.txt",
      displayPath: "/a.txt",
      version: null,
      identity: null,
      size: null,
      createdDirectories: [],
      atomic: true,
    });
    expect(fs.peek("/a.txt")).toBeNull();
  });

  test("a stale version gives changed", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const version = versionOf(fs, "/a.txt");
    fs.setFile("/a.txt", "two");
    const outcome = await fs.remove!("/a.txt", { precondition: { kind: "version", version } });
    expect(errorOf(outcome).reason).toBe("changed");
    expect(textOf(fs, "/a.txt")).toBe("two");
  });

  test("missing, directory, absent, and fault refusals", async () => {
    const fs = memoryFileSystem({
      files: { "/a.txt": "one" },
      directories: ["/dir"],
      faults: (operation) => (operation === "remove" ? { reason: "io", detail: "busy" } : null),
    });
    expect(errorOf(await fs.remove!("/b.txt", { precondition: ANY })).reason).toBe("not-found");
    expect(errorOf(await fs.remove!("/dir", { precondition: ANY })).reason).toBe("not-a-file");
    expect(errorOf(await fs.remove!("/a.txt", { precondition: ABSENT })).reason).toBe("exists");
    expect(errorOf(await fs.remove!("/a.txt", { precondition: ANY }))).toEqual({
      reason: "io",
      detail: "busy",
    });
    expect(textOf(fs, "/a.txt")).toBe("one");
  });
});

describe("memoryFileSystem stage", () => {
  test("the target keeps its bytes until publish", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const version = versionOf(fs, "/a.txt");
    const staged = stagedOf(
      await fs.stage!("/a.txt", bytes("two"), {
        precondition: { kind: "version", version },
        createParents: false,
      }),
    );
    expect(staged.resolvedPath).toBe("/a.txt");
    expect(textOf(fs, "/a.txt")).toBe("one");
    const file = fileOf(await staged.publish());
    expect(textOf(fs, "/a.txt")).toBe("two");
    expect(file.version).toBe(versionOf(fs, "/a.txt"));
  });

  test("stage checks the precondition", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const outcome = await fs.stage!("/a.txt", bytes("two"), {
      precondition: ABSENT,
      createParents: false,
    });
    expect(errorOf(outcome).reason).toBe("exists");
  });

  test("publish checks the precondition again", async () => {
    const fs = memoryFileSystem({ files: { "/a.txt": "one" } });
    const staged = stagedOf(
      await fs.stage!("/a.txt", bytes("two"), {
        precondition: { kind: "version", version: versionOf(fs, "/a.txt") },
        createParents: false,
      }),
    );
    fs.setFile("/a.txt", "other");
    expect(errorOf(await staged.publish()).reason).toBe("changed");
    expect(textOf(fs, "/a.txt")).toBe("other");
    await staged.discard();
  });

  test("a publish fault fails the publish and leaves the target", async () => {
    const fs = memoryFileSystem({
      files: { "/a.txt": "one" },
      faults: (operation) => (operation === "publish" ? { reason: "io", detail: "EIO" } : null),
    });
    const staged = stagedOf(
      await fs.stage!("/a.txt", bytes("two"), { precondition: ANY, createParents: false }),
    );
    expect(errorOf(await staged.publish())).toEqual({ reason: "io", detail: "EIO" });
    expect(textOf(fs, "/a.txt")).toBe("one");
  });

  test("a stage fault fails the stage", async () => {
    const fs = memoryFileSystem({
      faults: (operation) => (operation === "stage" ? { reason: "no-space" } : null),
    });
    const outcome = await fs.stage!("/x/a.txt", bytes("x"), {
      precondition: ABSENT,
      createParents: true,
    });
    expect(errorOf(outcome).reason).toBe("no-space");
    expect(await names(fs, "/")).toEqual([]);
  });

  test("publish is single use", async () => {
    const fs = memoryFileSystem();
    const staged = stagedOf(
      await fs.stage!("/a.txt", bytes("x"), { precondition: ANY, createParents: false }),
    );
    fileOf(await staged.publish());
    await expect(staged.publish()).rejects.toThrow(TypeError);
  });

  test("publish takes no signal: an abort after stage does not stop it", async () => {
    const fs = memoryFileSystem();
    const controller = new AbortController();
    const staged = stagedOf(
      await fs.stage!("/a.txt", bytes("x"), {
        precondition: ABSENT,
        createParents: false,
        signal: controller.signal,
      }),
    );
    controller.abort();
    fileOf(await staged.publish());
    expect(textOf(fs, "/a.txt")).toBe("x");
  });

  test("stage then discard leaves nothing", async () => {
    const fs = memoryFileSystem({ directories: ["/x"] });
    const staged = stagedOf(
      await fs.stage!("/x/y/z/a.txt", bytes("x"), { precondition: ABSENT, createParents: true }),
    );
    expect(await names(fs, "/x")).toEqual(["y"]);
    await staged.discard();
    await staged.discard();
    expect(fs.peek("/x/y/z/a.txt")).toBeNull();
    expect(await names(fs, "/x")).toEqual([]);
    await expect(staged.publish()).rejects.toThrow(TypeError);
  });

  test("publish reports the directories stage created", async () => {
    const fs = memoryFileSystem();
    const staged = stagedOf(
      await fs.stage!("/x/a.txt", bytes("x"), { precondition: ABSENT, createParents: true }),
    );
    expect(fileOf(await staged.publish()).createdDirectories).toEqual(["/x"]);
  });

  test("discard after publish keeps the file", async () => {
    const fs = memoryFileSystem();
    const staged = stagedOf(
      await fs.stage!("/x/a.txt", bytes("x"), { precondition: ABSENT, createParents: true }),
    );
    fileOf(await staged.publish());
    await staged.discard();
    expect(textOf(fs, "/x/a.txt")).toBe("x");
    expect(await names(fs, "/")).toEqual(["x"]);
  });

  test("discard keeps a created directory that is no longer empty", async () => {
    const fs = memoryFileSystem();
    const first = stagedOf(
      await fs.stage!("/x/a.txt", bytes("a"), { precondition: ABSENT, createParents: true }),
    );
    const second = stagedOf(
      await fs.stage!("/x/b.txt", bytes("b"), { precondition: ABSENT, createParents: true }),
    );
    await first.discard();
    expect(await names(fs, "/")).toEqual(["x"]);
    fileOf(await second.publish());
    expect(textOf(fs, "/x/b.txt")).toBe("b");

    const third = stagedOf(
      await fs.stage!("/y/c.txt", bytes("c"), { precondition: ABSENT, createParents: true }),
    );
    fs.setFile("/y/other.txt", "o");
    await third.discard();
    expect(await names(fs, "/y")).toEqual(["other.txt"]);
  });
});

describe("memoryFileSystem write helpers", () => {
  test("stage: false and remove: false remove the methods", () => {
    const fs = memoryFileSystem({ stage: false, remove: false });
    expect(fs.stage).toBeUndefined();
    expect(fs.remove).toBeUndefined();
    expect(isWritableFileSystem(fs)).toBe(true);
  });

  test("isWritableFileSystem needs writeCapabilities, stat, and write", () => {
    const { open, paths, capabilities } = memoryFileSystem();
    const readOnly: FileSystem = { id: "plain", open, paths, capabilities };
    expect(isWritableFileSystem(readOnly)).toBe(false);
    expect(isWritableFileSystem({ ...readOnly, writeCapabilities: null } as never)).toBe(false);
  });

  test("peek returns a copy with mode and version", () => {
    const fs = memoryFileSystem();
    fs.setFile("/a.txt", "abc", { mode: 0o600 });
    const peeked = fs.peek("/a.txt");
    expect(peeked?.mode).toBe(0o600);
    expect(peeked?.version).toBe("memory:/a.txt:1");
    peeked?.bytes.fill(0);
    expect(textOf(fs, "/a.txt")).toBe("abc");
    expect(fs.peek("/missing")).toBeNull();
  });

  test("setFile keeps the mode of an existing file and bumps the version", () => {
    const fs = memoryFileSystem();
    fs.setFile("/a.sh", "one", { mode: 0o755 });
    fs.setFile("/a.sh", "two");
    expect(fs.peek("/a.sh")).toMatchObject({ mode: 0o755, version: "memory:/a.sh:2" });
  });
});
