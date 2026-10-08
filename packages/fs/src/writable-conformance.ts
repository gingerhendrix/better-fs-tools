import { checkRunner, concat, equal, POLICY_REASONS, shapeProblem } from "./conformance.ts";
import type { ConformanceReport } from "./conformance.ts";
import type {
  MutationOutcome,
  Precondition,
  StatOutcome,
  WritableFileSystem,
  WriteOptions,
} from "./writable.ts";

export interface WritableConformanceFixtures {
  /** An existing, empty directory inside the roots. The suite creates and removes files in it. */
  readonly scratchDirectory: string;
  /** A directory the suite must refuse as a write target. Default: scratchDirectory. */
  readonly directoryPath?: string;
  /** A path the adapter's policy refuses for writing. */
  readonly refusedPath?: string;
}

const ENCODER = new TextEncoder();
const ANY: Precondition = { kind: "any" };
const ABSENT: Precondition = { kind: "absent" };

/**
 * Checks that a writable adapter keeps the write contract: stat agrees with
 * open, every precondition is enforced, parents are created and reported,
 * refusals are typed, and a staged write stays invisible until publish.
 */
export async function runWritableFileSystemConformance(
  fs: WritableFileSystem,
  fixtures: WritableConformanceFixtures,
): Promise<ConformanceReport> {
  const { checks, check } = checkRunner();
  const scratch = fixtures.scratchDirectory;
  const at = (...names: string[]) =>
    names.reduce((path, name) => fs.paths.join(path, name), scratch);
  const created = new Set<string>();

  const write = async (
    path: string,
    text: string,
    precondition: Precondition,
    extra: Partial<WriteOptions> = {},
  ): Promise<MutationOutcome> => {
    const outcome = await fs.write(path, ENCODER.encode(text), {
      precondition,
      createParents: false,
      ...extra,
    });
    if (outcome.ok) created.add(path);
    return outcome;
  };
  const existing = async (path: string) => {
    const outcome: StatOutcome = await fs.stat(path, {});
    if (!outcome.ok) throw new Error(`stat failed with ${outcome.error.reason}`);
    if (!outcome.stat.exists) throw new Error(`stat reports ${path} as missing`);
    return outcome.stat;
  };
  const contentProblem = async (path: string, text: string): Promise<string | null> => {
    const opened = await fs.open(path, {});
    if (!opened.ok) return `open failed with ${opened.error.reason}`;
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of opened.file.bytes()) chunks.push(Uint8Array.from(chunk));
      return equal(concat(chunks), ENCODER.encode(text)) ? null : `${path} holds other bytes`;
    } finally {
      await opened.file.close();
    }
  };
  const expectReason = (outcome: MutationOutcome | StatOutcome, reason: string) => {
    if (outcome.ok) return `expected ${reason}, the call succeeded`;
    return outcome.error.reason === reason ? null : `reason was ${outcome.error.reason}`;
  };

  await check("shape", async () => shapeProblem(fs));

  await check("write shape", async () => {
    if (typeof fs.stat !== "function") return "stat must be a function";
    if (typeof fs.write !== "function") return "write must be a function";
    if (fs.stage !== undefined && typeof fs.stage !== "function") {
      return "stage must be a function when present";
    }
    if (fs.remove !== undefined && typeof fs.remove !== "function") {
      return "remove must be a function when present";
    }
    if (typeof fs.writeCapabilities?.compareAndSwap !== "boolean") {
      return "writeCapabilities.compareAndSwap missing";
    }
    return null;
  });

  const target = at("wfc-file.txt");

  await check("absent creates a file", async () => {
    const outcome = await write(target, "one\n", ABSENT);
    if (!outcome.ok) return `write failed with ${outcome.error.reason}`;
    if (typeof outcome.file.version !== "string" || outcome.file.version === "") {
      return "the created file has no version";
    }
    if (outcome.file.createdDirectories.length !== 0) {
      return "created directories in an existing parent";
    }
    return null;
  });

  await check("the bytes round-trip through open()", async () => contentProblem(target, "one\n"));

  await check("stat of an existing file matches open().info.version", async () => {
    const stat = await existing(target);
    if (stat.size !== ENCODER.encode("one\n").byteLength) return `size was ${stat.size}`;
    const opened = await fs.open(target, {});
    if (!opened.ok) return `open failed with ${opened.error.reason}`;
    await opened.file.close();
    if (opened.file.info.version !== stat.version) return "stat and open report other versions";
    return opened.file.info.resolvedPath === stat.resolvedPath
      ? null
      : "stat and open report other resolved paths";
  });

  await check("absent on an existing file gives exists", async () => {
    const problem = expectReason(await write(target, "two\n", ABSENT), "exists");
    return problem ?? contentProblem(target, "one\n");
  });

  await check("a stale version gives changed", async () => {
    const stale = (await existing(target)).version;
    const replaced = await write(target, "other\n", ANY);
    if (!replaced.ok) return `write failed with ${replaced.error.reason}`;
    const outcome = await write(target, "mine\n", { kind: "version", version: stale });
    return expectReason(outcome, "changed") ?? contentProblem(target, "other\n");
  });

  await check("the current version replaces and changes the version", async () => {
    const before = (await existing(target)).version;
    const outcome = await write(target, "three\n", { kind: "version", version: before });
    if (!outcome.ok) return `write failed with ${outcome.error.reason}`;
    if (outcome.file.version === before) return "the version did not change";
    if ((await existing(target)).version !== outcome.file.version) {
      return "write and stat report other versions";
    }
    return contentProblem(target, "three\n");
  });

  await check("any replaces", async () => {
    const outcome = await write(target, "four\n", ANY);
    if (!outcome.ok) return `write failed with ${outcome.error.reason}`;
    return contentProblem(target, "four\n");
  });

  await check("stat of a missing path gives exists false and missingDirectories", async () => {
    const near = await fs.stat(at("wfc-missing.txt"), {});
    if (!near.ok) return `stat failed with ${near.error.reason}`;
    if (near.stat.exists) return "a missing path exists";
    if (near.stat.missingDirectories.length !== 0) return "missing parents in an existing parent";
    const far = await fs.stat(at("wfc-missing", "deeper", "x.txt"), {});
    if (!far.ok) return `stat failed with ${far.error.reason}`;
    if (far.stat.exists) return "a missing path exists";
    return far.stat.missingDirectories.length === 2
      ? null
      : `missingDirectories had ${far.stat.missingDirectories.length} entries, expected 2`;
  });

  await check("a missing parent is refused without createParents", async () => {
    const path = at("wfc-no-parent", "x.txt");
    const outcome = await write(path, "x\n", ABSENT);
    if (outcome.ok) return "wrote into a missing parent";
    const stat = await fs.stat(path, {});
    return stat.ok && !stat.stat.exists ? null : "the refused write left a file";
  });

  await check("createParents creates and reports directories", async () => {
    const path = at("wfc-parents", "inner", "x.txt");
    const outcome = await write(path, "x\n", ABSENT, { createParents: true });
    if (!outcome.ok) return `write failed with ${outcome.error.reason}`;
    const [outer, inner, ...rest] = outcome.file.createdDirectories;
    if (outer === undefined || inner === undefined || rest.length > 0) {
      return `createdDirectories had ${outcome.file.createdDirectories.length} entries, expected 2`;
    }
    if (!inner.startsWith(outer)) return "createdDirectories is not outermost first";
    return contentProblem(path, "x\n");
  });

  const modeTarget = at("wfc-mode.txt");
  await check("a new file takes options.mode", async () => {
    const outcome = await write(modeTarget, "x\n", ABSENT, { mode: 0o600 });
    if (!outcome.ok) return `write failed with ${outcome.error.reason}`;
    const mode = (await existing(modeTarget)).mode;
    return mode === null || mode === 0o600 ? null : `mode was ${mode.toString(8)}`;
  });

  await check("a replace keeps the mode", async () => {
    const before = await existing(modeTarget);
    const outcome = await write(
      modeTarget,
      "y\n",
      { kind: "version", version: before.version },
      { mode: 0o644 },
    );
    if (!outcome.ok) return `write failed with ${outcome.error.reason}`;
    const mode = (await existing(modeTarget)).mode;
    return mode === before.mode ? null : `mode changed to ${mode?.toString(8)}`;
  });

  const directoryPath = fixtures.directoryPath ?? scratch;
  await check("a directory target gives not-a-file", async () => {
    const problem = expectReason(await write(directoryPath, "x\n", ANY), "not-a-file");
    return problem ?? expectReason(await fs.stat(directoryPath, {}), "not-a-file");
  });

  if (fixtures.refusedPath !== undefined) {
    const refusedPath = fixtures.refusedPath;
    await check("a refused path gives a policy reason", async () => {
      const outcome = await write(refusedPath, "x\n", ANY);
      if (outcome.ok) return "a refused path was written";
      return (POLICY_REASONS as readonly string[]).includes(outcome.error.reason)
        ? null
        : `reason was ${outcome.error.reason}`;
    });
  }

  await check("an aborted signal gives aborted", async () => {
    const signal = AbortSignal.abort();
    const problem =
      expectReason(await fs.stat(target, { signal }), "aborted") ??
      expectReason(await write(target, "aborted\n", ANY, { signal }), "aborted");
    return problem ?? contentProblem(target, "four\n");
  });

  if (fs.remove !== undefined) {
    const remove = fs.remove.bind(fs);
    const removeTarget = at("wfc-remove.txt");
    await check("remove with a stale version gives changed", async () => {
      const first = await write(removeTarget, "one\n", ABSENT);
      if (!first.ok) return `write failed with ${first.error.reason}`;
      const stale = (await existing(removeTarget)).version;
      const second = await write(removeTarget, "two\n", ANY);
      if (!second.ok) return `write failed with ${second.error.reason}`;
      const outcome = await remove(removeTarget, {
        precondition: { kind: "version", version: stale },
      });
      return expectReason(outcome, "changed") ?? contentProblem(removeTarget, "two\n");
    });

    await check("remove with the current version removes the file", async () => {
      const version = (await existing(removeTarget)).version;
      const outcome = await remove(removeTarget, { precondition: { kind: "version", version } });
      if (!outcome.ok) return `remove failed with ${outcome.error.reason}`;
      if (outcome.file.version !== null) return "remove reported a version";
      created.delete(removeTarget);
      const stat = await fs.stat(removeTarget, {});
      return stat.ok && !stat.stat.exists ? null : "the file still exists";
    });
  }

  if (fs.stage !== undefined) {
    const stage = fs.stage.bind(fs);
    await check("stage then publish replaces the target", async () => {
      const before = (await existing(target)).version;
      const staged = await stage(target, ENCODER.encode("staged\n"), {
        precondition: { kind: "version", version: before },
        createParents: false,
      });
      if (!staged.ok) return `stage failed with ${staged.error.reason}`;
      try {
        const early = await contentProblem(target, "four\n");
        if (early !== null) return `the target changed before publish: ${early}`;
        const published = await staged.staged.publish();
        if (!published.ok) return `publish failed with ${published.error.reason}`;
        if (published.file.version === before) return "the version did not change";
        return contentProblem(target, "staged\n");
      } finally {
        await staged.staged.discard();
      }
    });

    await check("publish checks the precondition again", async () => {
      const before = (await existing(target)).version;
      const staged = await stage(target, ENCODER.encode("late\n"), {
        precondition: { kind: "version", version: before },
        createParents: false,
      });
      if (!staged.ok) return `stage failed with ${staged.error.reason}`;
      try {
        const between = await write(target, "between\n", ANY);
        if (!between.ok) return `write failed with ${between.error.reason}`;
        const problem = expectReason(await staged.staged.publish(), "changed");
        return problem ?? contentProblem(target, "between\n");
      } finally {
        await staged.staged.discard();
      }
    });

    await check("stage then discard leaves nothing", async () => {
      const path = at("wfc-discard", "x.txt");
      const staged = await stage(path, ENCODER.encode("x\n"), {
        precondition: ABSENT,
        createParents: true,
      });
      if (!staged.ok) return `stage failed with ${staged.error.reason}`;
      await staged.staged.discard();
      await staged.staged.discard();
      const stat = await fs.stat(path, {});
      if (!stat.ok) return `stat failed with ${stat.error.reason}`;
      if (stat.stat.exists) return "the discarded file exists";
      return stat.stat.missingDirectories.length === 1
        ? null
        : "discard left the directory stage() created";
    });
  }

  if (fs.remove !== undefined) {
    for (const path of created) await fs.remove(path, { precondition: ANY }).catch(() => null);
  }

  return { adapter: fs.id, passed: checks.every((entry) => entry.ok), checks };
}
