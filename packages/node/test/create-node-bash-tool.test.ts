import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import {
  createNodeBashTool,
  createNodeFsTools,
  nodeCommandRunner,
  nodeFileSystem,
} from "@better-fs-tools/node";
import type { NodeFsToolsWithBash } from "@better-fs-tools/node";
import { memoryStore } from "@better-fs-tools/read";
import { textOf } from "@better-fs-tools/shell";

async function workdir(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "bash-tool-")));
}

function isProcessWithMarkerRunning(marker: string): boolean {
  const list = spawnSync("ps", ["-eo", "args"], { encoding: "utf8" }).stdout;
  return list.split("\n").some((line) => line.includes(marker) && !line.includes("ps -eo"));
}

async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

describe("createNodeBashTool", () => {
  test("runs a command in the runner cwd and reports the exit code", async () => {
    const cwd = await workdir();
    const bash = createNodeBashTool({ runner: nodeCommandRunner({ cwd }) });
    const result = await bash({ command: "pwd; echo err >&2; exit 3" });
    expect(result.status).toBe("failed");
    expect(result.run?.exitCode).toBe(3);
    // stdout and stderr are two pipes merged in arrival order, so either line may come first.
    expect(result.output?.head.split("\n").sort()).toEqual([cwd, "err"].sort());
  });

  test("a timeout kills a grandchild: no process is left", async () => {
    const marker = `sleep 97.${process.pid}`;
    const bash = createNodeBashTool({ limits: { killGraceMs: 200 } });
    const result = await bash({ command: `${marker} & ${marker}`, timeoutMs: 300 });
    expect(result.status).toBe("timeout");
    expect(await waitUntil(() => !isProcessWithMarkerRunning(marker), 2_000)).toBe(true);
  });

  test("a SIGTERM trap does not save the tree: SIGKILL follows the grace time", async () => {
    const marker = `sleep 96.${process.pid}`;
    const bash = createNodeBashTool({ limits: { killGraceMs: 200 } });
    const command = `trap '' TERM; (trap '' TERM; ${marker}) & ${marker}`;
    const result = await bash({ command, timeoutMs: 300 });
    expect(result.status).toBe("timeout");
    expect(await waitUntil(() => !isProcessWithMarkerRunning(marker), 2_000)).toBe(true);
  });

  test("abort during a run stops the tree and returns the output so far", async () => {
    const marker = `sleep 95.${process.pid}`;
    const controller = new AbortController();
    const bash = createNodeBashTool();
    const pending = bash({ command: `echo started; ${marker}` }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    const result = await pending;
    expect(result.status === "error" ? result.error.code : result.status).toBe("ABORTED");
    expect(result.output?.head).toBe("started");
    expect(await waitUntil(() => !isProcessWithMarkerRunning(marker), 2_000)).toBe(true);
  });

  test("a command that reads stdin gets end of file", async () => {
    const result = await createNodeBashTool()({
      command: "cat; read x || echo eof",
      timeoutMs: 5_000,
    });
    expect(result.status).toBe("ok");
    expect(result.output?.head).toBe("eof");
  });

  test("a background child does not hold the call open after the shell exits", async () => {
    const marker = `sleep 94.${process.pid}`;
    const started = Date.now();
    const result = await createNodeBashTool()({ command: `${marker} & echo done` });
    expect(result.status).toBe("ok");
    expect(result.output?.head).toBe("done");
    expect(Date.now() - started).toBeLessThan(3_000);
    spawnSync("pkill", ["-f", marker]);
  });

  test("large output keeps the head, the tail, and the count", async () => {
    const result = await createNodeBashTool()({ command: "seq 1 200000" });
    expect(result.output?.totalLines).toBe(200_000);
    expect(result.output?.head.split("\n")[0]).toBe("1");
    expect(result.output?.tail?.split("\n").at(-1)).toBe("200000");
    expect(textOf(result)).toContain("lines (");
  });

  test("the default env turns pagers and colour off and keeps process.env", async () => {
    process.env.BASH_TOOL_TEST = "yes";
    const result = await createNodeBashTool()({
      command: 'echo "$PAGER $GIT_PAGER $NO_COLOR $TERM $BASH_TOOL_TEST"',
    });
    delete process.env.BASH_TOOL_TEST;
    expect(result.output?.head).toBe("cat cat 1 dumb yes");
  });

  test("a relative cwd resolves against process.cwd(), as nodeCommandRunner does", async () => {
    const cwd = await realpath(await workdir());
    const rel = relative(process.cwd(), cwd);
    const bash = createNodeBashTool({ cwd: rel });
    const result = await bash({ command: "pwd" });
    expect(result.status).toBe("ok");
    expect(result.run?.cwd).toBe(cwd);
    const bundled = createNodeFsTools({ cwd, bash: { cwd: rel } });
    expect((await bundled.bash({ command: "pwd" })).run?.cwd).toBe(cwd);
  });

  test("a missing cwd is CWD_NOT_FOUND and a file cwd is CWD_NOT_A_DIRECTORY", async () => {
    const cwd = await workdir();
    await writeFile(join(cwd, "file.txt"), "x");
    const bash = createNodeBashTool({ runner: nodeCommandRunner({ cwd }) });
    expect(errorOf(await bash({ command: "ls", cwd: "missing" }))?.code).toBe("CWD_NOT_FOUND");
    expect(errorOf(await bash({ command: "ls", cwd: "file.txt" }))?.code).toBe(
      "CWD_NOT_A_DIRECTORY",
    );
  });

  test("a relative cwd resolves against process.cwd(), as in nodeFileSystem", async () => {
    const parent = await workdir();
    await mkdir(join(parent, "packages"));
    const before = process.cwd();
    process.chdir(parent);
    try {
      const runner = nodeCommandRunner({ cwd: "packages" });
      const fs = nodeFileSystem({ cwd: "packages", allowedRoots: ["."] });
      expect(runner.cwd).toBe(join(parent, "packages"));
      expect(fs.cwd).toBe(runner.cwd);
    } finally {
      process.chdir(before);
    }
    expect(() => nodeCommandRunner({ cwd: "" })).toThrow(TypeError);
    expect(() => nodeCommandRunner({ cwd: "a\0b" })).toThrow(TypeError);
  });

  test("a missing shell is SPAWN_FAILED", async () => {
    const runner = nodeCommandRunner({ shell: "/no/such/shell" });
    const result = await createNodeBashTool({ runner })({ command: "true" });
    expect(errorOf(result)?.code).toBe("SPAWN_FAILED");
  });
});

describe("createNodeFsTools bash", () => {
  test("is off by default: the bundle has no bash tool and starts no process", () => {
    expect(createNodeFsTools().bash).toBeNull();
    expect(createNodeFsTools({ bash: false }).bash).toBeNull();
  });

  test("bash: true runs in cwd with process.env, and gets the shared digest and clock", async () => {
    const cwd = await workdir();
    const now = new Date("2026-09-29T00:00:00.000Z");
    const plain = createNodeFsTools({ cwd, bash: true });
    const ran = await plain.bash({ command: 'pwd; printf "%s" "$HOME"' });
    expect(ran.output?.head).toBe(`${cwd}\n${process.env.HOME}`);
    const seen: unknown[] = [];
    const tools = createNodeFsTools({
      cwd,
      clock: () => now,
      bash: {
        authorize: {
          id: "spy",
          authorize: (_target, ctx) => {
            seen.push(ctx.digest, ctx.clock());
            return { allow: true };
          },
        },
      },
    });
    await tools.bash({ command: "true" });
    expect(seen).toEqual([tools.digest, now]);
    expect(tools.digest.id).toBe("sha256");
  });

  test("runs in the shared cwd, and an afterRun hook can invalidate a read record", async () => {
    const cwd = await workdir();
    await writeFile(join(cwd, "a.txt"), "one\n");
    let tools: NodeFsToolsWithBash | undefined;
    tools = createNodeFsTools({
      cwd,
      state: memoryStore(),
      bash: {
        afterRun: [
          {
            id: "invalidate",
            afterRun: async () => {
              await tools?.invalidate("a.txt");
              return {};
            },
          },
        ],
      },
    });
    await tools.read({ path: "a.txt" });
    const ran = await tools.bash({ command: "printf 'two\\n' > a.txt; pwd" });
    expect(ran.output?.head).toBe(cwd);
    const edit = await tools.edit({ path: "a.txt", edits: [{ oldText: "two", newText: "three" }] });
    expect(errorOf(edit)?.code).toBe("NOT_READ");
  });

  test("an explicit cwd applies to a given runner, which has its own default cwd", async () => {
    const cwd = await workdir();
    const other = await workdir();
    const tools = createNodeFsTools({ cwd, bash: { runner: nodeCommandRunner({ cwd: other }) } });
    const ran = await tools.bash({ command: "pwd" });
    expect(ran.output?.head).toBe(cwd);
  });

  test("bash.cwd wins over the top-level cwd", async () => {
    const cwd = await workdir();
    const other = await workdir();
    const tools = createNodeFsTools({ cwd, bash: { runner: nodeCommandRunner(), cwd: other } });
    expect((await tools.bash({ command: "pwd" })).output?.head).toBe(other);
  });

  test("without a top-level cwd, a given runner keeps its own cwd", async () => {
    const other = await workdir();
    const tools = createNodeFsTools({ bash: { runner: nodeCommandRunner({ cwd: other }) } });
    expect((await tools.bash({ command: "pwd" })).output?.head).toBe(other);
  });
});

function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
