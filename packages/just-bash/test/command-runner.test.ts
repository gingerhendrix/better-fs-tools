import { describe, expect, test } from "bun:test";

import { Bash } from "just-bash";

import { createBashTool } from "@better-fs-tools/shell";

import { justBashCommandRunner } from "../src/index.ts";

function shell(executionLimits = {}): Bash {
  // just-bash 3.4.2 defense in depth cannot patch Bun's module loader, even in "auto".
  // Node runs it with the default. The tests run under Bun, so they turn it off.
  return new Bash({
    files: { "/w/a.txt": "alpha\n", "/w/sub/b.txt": "beta\n" },
    cwd: "/w",
    defenseInDepth: false,
    executionLimits,
  });
}

describe("justBashCommandRunner", () => {
  test("runs in the emulated shell and reports stdout, stderr, and the exit code", async () => {
    const bash = createBashTool({ runner: justBashCommandRunner(shell()) });
    const result = await bash({ command: "cat a.txt; echo oops >&2; exit 4" });
    expect(result.status).toBe("failed");
    expect(result.run?.exitCode).toBe(4);
    expect(result.output?.head).toBe("alpha\noops");
  });

  test("the cwd input is resolved against the shell's cwd, for this call only", async () => {
    const emulated = shell();
    const bash = createBashTool({ runner: justBashCommandRunner(emulated) });
    expect((await bash({ command: "pwd; cat b.txt", cwd: "sub" })).output?.head).toBe(
      "/w/sub\nbeta",
    );
    expect((await bash({ command: "pwd" })).output?.head).toBe("/w");
  });

  test("a relative runner cwd throws: there is no process cwd to resolve it against", () => {
    expect(() => justBashCommandRunner(shell(), { cwd: "sub" })).toThrow(
      "cwd must be an absolute path: just-bash has no process cwd",
    );
  });

  test("the environment replaces the shell's own", async () => {
    const bash = createBashTool({
      runner: justBashCommandRunner(shell()),
      env: () => ({ ONLY: "this" }),
    });
    const result = await bash({ command: 'echo "$ONLY:${HOME:-none}"' });
    expect(result.output?.head).toBe("this:none");
  });

  test("stdin is empty", async () => {
    const bash = createBashTool({ runner: justBashCommandRunner(shell()) });
    expect((await bash({ command: "cat; echo end" })).output?.head).toBe("end");
  });

  test("a missing or file cwd maps to the cwd errors", async () => {
    const bash = createBashTool({ runner: justBashCommandRunner(shell()) });
    expect(errorOf(await bash({ command: "ls", cwd: "nope" }))?.code).toBe("CWD_NOT_FOUND");
    expect(errorOf(await bash({ command: "ls", cwd: "a.txt" }))?.code).toBe("CWD_NOT_A_DIRECTORY");
  });

  test("the description names the emulated runner", () => {
    expect(justBashCommandRunner(shell()).id).toBe("just-bash (emulated)");
  });

  test("fact check: a busy loop starves the timer; just-bash's own limits end it", async () => {
    // The interpreter does not yield to the event loop inside a busy loop, so
    // the core's timeout cannot fire. just-bash's executionLimits stop it.
    const bash = createBashTool({
      runner: justBashCommandRunner(shell({ maxCommandCount: 10_000 })),
      limits: { killGraceMs: 100 },
    });
    const result = await bash({ command: "while true; do :; done", timeoutMs: 1 });
    expect(result.status).toBe("failed");
    expect(result.run?.stoppedBy).toBeNull();
    expect(result.output?.head).toContain("too many commands executed");
  });

  test("fact check: a timeout during sleep ends the call within the grace time", async () => {
    const bash = createBashTool({
      runner: justBashCommandRunner(shell()),
      limits: { killGraceMs: 100 },
    });
    const started = Date.now();
    const result = await bash({ command: "sleep 30", timeoutMs: 200 });
    expect(result.status).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});

/** The error of a result, or null when its status is not "error". */
function errorOf<T extends { readonly status: string }>(
  result: T,
): (T extends { readonly status: "error"; readonly error: infer E } ? E : never) | null {
  return result.status === "error" ? (result as unknown as { readonly error: never }).error : null;
}
