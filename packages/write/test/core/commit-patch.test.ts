import { describe, expect, test } from "bun:test";

import type {
  MemoryFileSystem,
  MutationError,
  WritableFileSystem,
  WriteOptions,
} from "@better-fs-tools/fs";
import { textOf } from "@better-fs-tools/read";

import { codes, harness, patchText, text } from "../helpers.ts";

type Operation = "write" | "stage" | "publish" | "remove";

const IO: MutationError = { reason: "io", detail: "injected" };

/**
 * A fault plan: `fail(operation, path, nth)` fails the nth call (1-based)
 * of that operation on that path. Calls are counted per operation and path.
 */
function faults() {
  const counts = new Map<string, number>();
  const failing = new Map<string, MutationError>();
  const log: string[] = [];
  return {
    log,
    fail(operation: Operation, path: string, nth = 1, error: MutationError = IO) {
      failing.set(`${operation} ${path} ${nth}`, error);
    },
    hook: (operation: Operation, path: string): MutationError | null => {
      const key = `${operation} ${path}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      log.push(key);
      return failing.get(`${key} ${count}`) ?? null;
    },
  };
}

const FILES = { "/a.ts": "a\n", "/b.ts": "b\n", "/c.ts": "c\n" };

/** Updates a and b, adds n, deletes c: one step of each kind. */
const PATCH = patchText(
  "*** Update File: /a.ts",
  "@@",
  "-a",
  "+A",
  "*** Add File: /new/n.ts",
  "+n",
  "*** Update File: /b.ts",
  "@@",
  "-b",
  "+B",
  "*** Delete File: /c.ts",
);

interface SetupOptions {
  readonly stage: boolean;
  /** Modes to give files before they are read. */
  readonly modes?: Readonly<Record<string, number>>;
  /** Runs at each faults() call, before the fault plan decides. */
  readonly during?: (operation: Operation, path: string, fs: MemoryFileSystem) => void;
}

async function setup(options: SetupOptions) {
  const plan = faults();
  const tools = harness({
    files: FILES,
    fsOptions: {
      stage: options.stage,
      faults: (operation, path) => {
        options.during?.(operation, path, tools.fs);
        return plan.hook(operation, path);
      },
    },
  });
  for (const [path, mode] of Object.entries(options.modes ?? {})) {
    tools.fs.setFile(path, FILES[path as keyof typeof FILES], { mode });
  }
  for (const path of Object.keys(FILES)) await tools.read({ path });
  const before = snapshot(tools.fs);
  return { ...tools, plan, before };
}

function snapshot(fs: MemoryFileSystem) {
  return ["/a.ts", "/b.ts", "/c.ts", "/new/n.ts"].map((path) => fs.peek(path)?.bytes ?? null);
}

describe.each([
  ["with stage()", true, "publish"],
  ["without stage()", false, "write"],
] as const)("the staged commit and rollback (W5), %s", (_name, stage, publish) => {
  test("every step publishes in patch order", async () => {
    const { applyPatch, fs, plan } = await setup({ stage });
    const result = await applyPatch({ patch: PATCH });
    expect(result.status).toBe("ok");
    expect(result.commit).toBeNull();
    expect([text(fs, "/a.ts"), text(fs, "/new/n.ts"), text(fs, "/b.ts")]).toEqual([
      "A\n",
      "n\n",
      "B\n",
    ]);
    expect(fs.peek("/c.ts")).toBeNull();
    const steps = plan.log.filter((entry) => !entry.startsWith("stage"));
    expect(steps).toEqual([
      `${publish} /a.ts`,
      `${publish} /new/n.ts`,
      `${publish} /b.ts`,
      "remove /c.ts",
    ]);
    if (stage) {
      expect(plan.log.slice(0, 3)).toEqual(["stage /a.ts", "stage /new/n.ts", "stage /b.ts"]);
    }
  });

  test("a publish failure on the second file restores the first", async () => {
    const { applyPatch, fs, plan, before } = await setup({ stage });
    plan.fail(publish, "/new/n.ts");
    const result = await applyPatch({ patch: PATCH });
    expect(result.error).toEqual({
      code: "IO_ERROR",
      phase: "commit",
      data: { path: "/new/n.ts", rolledBack: true },
    });
    expect(result.commit).toEqual({
      rolledBack: true,
      files: [
        { path: "/a.ts", state: "restored" },
        { path: "/new/n.ts", state: "unchanged", code: "IO_ERROR" },
        { path: "/b.ts", state: "unchanged" },
        { path: "/c.ts", state: "unchanged" },
      ],
    });
    expect(result.changes).toEqual([]);
    expect(snapshot(fs)).toEqual(before);
    expect(textOf(result)).toBe(
      "[apply_patch:io-error] Patch commit failed at /new/n.ts (IO_ERROR). The patch was rolled back. No files are changed.",
    );
  });

  test("a failure after a delete restores the deleted file with its mode", async () => {
    const { applyPatch, fs, plan } = await setup({ stage, modes: { "/c.ts": 0o600 } });
    plan.fail(publish, "/a.ts");
    const result = await applyPatch({
      patch: patchText("*** Delete File: /c.ts", "*** Update File: /a.ts", "@@", "-a", "+A"),
    });
    expect(result.commit).toEqual({
      rolledBack: true,
      files: [
        { path: "/c.ts", state: "restored" },
        { path: "/a.ts", state: "unchanged", code: "IO_ERROR" },
      ],
    });
    expect(fs.peek("/c.ts")).toMatchObject({ mode: 0o600 });
    expect(text(fs, "/c.ts")).toBe("c\n");
    expect(text(fs, "/a.ts")).toBe("a\n");
  });

  test("a failed move restores the source and removes the destination", async () => {
    const { applyPatch, fs, plan } = await setup({ stage });
    plan.fail("remove", "/c.ts");
    const result = await applyPatch({
      patch: patchText(
        "*** Update File: /a.ts",
        "*** Move to: /moved/a.ts",
        "@@",
        "-a",
        "+A",
        "*** Delete File: /c.ts",
      ),
    });
    expect(result.error).toMatchObject({ code: "IO_ERROR", phase: "commit" });
    expect(result.commit).toEqual({
      rolledBack: true,
      files: [
        { path: "/a.ts", state: "restored" },
        { path: "/moved/a.ts", state: "restored" },
        { path: "/c.ts", state: "unchanged", code: "IO_ERROR" },
      ],
    });
    expect(text(fs, "/a.ts")).toBe("a\n");
    expect(fs.peek("/moved/a.ts")).toBeNull();
    expect(text(fs, "/c.ts")).toBe("c\n");
  });

  test("a failed rollback step gives PARTIAL_COMMIT with each file's state", async () => {
    const { applyPatch, fs, plan } = await setup({ stage });
    plan.fail(publish, "/b.ts");
    // The rollback of /a.ts is a write. Without stage() the publish was write number 1.
    plan.fail("write", "/a.ts", stage ? 1 : 2);
    const result = await applyPatch({ patch: PATCH });
    expect(result.error).toEqual({
      code: "PARTIAL_COMMIT",
      phase: "commit",
      data: { path: "/b.ts", cause: "IO_ERROR", rolledBack: false },
    });
    expect(result.commit).toEqual({
      rolledBack: false,
      files: [
        { path: "/a.ts", state: "rollback-failed", code: "IO_ERROR" },
        { path: "/new/n.ts", state: "restored" },
        { path: "/b.ts", state: "unchanged", code: "IO_ERROR" },
        { path: "/c.ts", state: "unchanged" },
      ],
    });
    expect(result.changes.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: "update", path: "/a.ts" },
    ]);
    expect(text(fs, "/a.ts")).toBe("A\n");
    expect(fs.peek("/new/n.ts")).toBeNull();
    expect(text(fs, "/b.ts")).toBe("b\n");
    expect(textOf(result)).toBe(
      [
        "[apply_patch:partial-commit] Patch commit failed at /b.ts (IO_ERROR). Rollback failed, so these files are in a mixed state:",
        "rollback-failed /a.ts",
        "restored /new/n.ts",
        "unchanged /b.ts",
        "unchanged /c.ts",
      ].join("\n"),
    );
  });

  test("a rollback does not overwrite a file another writer changed after the publish", async () => {
    const { applyPatch, fs, plan } = await setup({
      stage,
      during: (operation, path, memory) => {
        // Another writer changes /a.ts while /b.ts publishes.
        if (operation === publish && path === "/b.ts") memory.setFile("/a.ts", "theirs\n");
      },
    });
    plan.fail(publish, "/b.ts");
    const result = await applyPatch({ patch: PATCH });
    expect(result.error?.code).toBe("PARTIAL_COMMIT");
    expect(result.commit?.files[0]).toEqual({
      path: "/a.ts",
      state: "rollback-failed",
      code: "STALE",
    });
    expect(text(fs, "/a.ts")).toBe("theirs\n");
  });
});

describe("the stage step", () => {
  test("a stage failure discards every staged write and changes nothing", async () => {
    const { applyPatch, fs, plan, before } = await setup({ stage: true });
    plan.fail("stage", "/b.ts", 1, { reason: "no-space" });
    const result = await applyPatch({ patch: PATCH });
    expect(result.error).toMatchObject({ code: "NO_SPACE", phase: "commit" });
    expect(result.commit).toBeNull();
    expect(snapshot(fs)).toEqual(before);
    expect(plan.log.some((entry) => entry.startsWith("publish"))).toBe(false);
    // The directory stage() made for /new/n.ts is gone again.
    const stat = await fs.stat("/new/n.ts", {});
    expect(stat.ok && !stat.stat.exists && stat.stat.missingDirectories).toEqual(["/new"]);
  });
});

describe("a backend without compare-and-swap", () => {
  /** Reports compareAndSwap: false, has no stage(), and ignores preconditions. */
  function unchecked(fs: MemoryFileSystem): WritableFileSystem {
    return {
      id: "no-cas",
      capabilities: fs.capabilities,
      paths: fs.paths,
      writeCapabilities: { ...fs.writeCapabilities, compareAndSwap: false },
      open: (path, options) => fs.open(path, options),
      stat: (path, options) => fs.stat(path, options),
      write: (path, bytes, options: WriteOptions) =>
        fs.write(path, bytes, { ...options, precondition: { kind: "any" } }),
      remove: async (path) =>
        (await fs.remove?.(path, { precondition: { kind: "any" } })) ?? {
          ok: false,
          error: { reason: "unsupported" },
        },
    };
  }

  test("the core checks each step itself and rolls back on a change", async () => {
    const tools = harness({
      files: FILES,
      writeFs: unchecked,
      deps: {
        guards: [
          {
            id: "racer",
            check: (change) => {
              // Another writer changes /b.ts after load, before the commit.
              if (change.displayPath === "/b.ts") tools.fs.setFile("/b.ts", "theirs\n");
              return { allow: true };
            },
          },
        ],
      },
    });
    for (const path of Object.keys(FILES)) await tools.read({ path });
    const result = await tools.applyPatch({ patch: PATCH });
    expect(result.error).toMatchObject({ code: "STALE", phase: "commit" });
    expect(result.commit?.rolledBack).toBe(true);
    expect(text(tools.fs, "/a.ts")).toBe("a\n");
    expect(tools.fs.peek("/new/n.ts")).toBeNull();
    expect(text(tools.fs, "/b.ts")).toBe("theirs\n");
    expect(text(tools.fs, "/c.ts")).toBe("c\n");
  });

  test("a clean commit adds the no-compare-and-swap note", async () => {
    const tools = harness({ files: FILES, writeFs: unchecked });
    for (const path of Object.keys(FILES)) await tools.read({ path });
    const result = await tools.applyPatch({ patch: PATCH });
    expect(result.status).toBe("ok");
    expect(codes(result)).toContain("no-compare-and-swap");
  });
});

describe("abort", () => {
  test("an abort before the commit gives ABORTED and changes nothing", async () => {
    const controller = new AbortController();
    const tools = harness({
      files: FILES,
      deps: {
        guards: [
          {
            id: "abort",
            check: () => {
              controller.abort();
              return { allow: true };
            },
          },
        ],
      },
    });
    for (const path of Object.keys(FILES)) await tools.read({ path });
    const before = snapshot(tools.fs);
    const result = await tools.applyPatch({ patch: PATCH }, { signal: controller.signal });
    expect(result.error?.code).toBe("ABORTED");
    expect(snapshot(tools.fs)).toEqual(before);
  });

  test("an abort during the commit is ignored: the patch finishes", async () => {
    const controller = new AbortController();
    const tools = harness({
      files: FILES,
      fsOptions: {
        faults: (operation) => {
          if (operation === "publish") controller.abort();
          return null;
        },
      },
    });
    for (const path of Object.keys(FILES)) await tools.read({ path });
    const result = await tools.applyPatch({ patch: PATCH }, { signal: controller.signal });
    expect(result.status).toBe("ok");
    expect(text(tools.fs, "/b.ts")).toBe("B\n");
  });
});
