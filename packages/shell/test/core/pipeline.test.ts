import { describe, expect, test } from "bun:test";

import { createBashTool, defaultShellEnv } from "@better-fs-tools/shell";
import type { CommandRunner, OutputChunk, RunOutcome } from "@better-fs-tools/shell";

import { err, out, scriptedRunner, text } from "../helpers.ts";

describe("statuses", () => {
  test("exit 0 is ok, with the exit code first in the text", async () => {
    const bash = createBashTool({ runner: scriptedRunner({ steps: [out("hello\n")] }) });
    const result = await bash({ command: "echo hello" });
    expect(result.status).toBe("ok");
    expect(result.error).toBeNull();
    expect(result.run?.exitCode).toBe(0);
    expect(text(result)).toMatch(/^Exit code 0 · \d+(\.\d)? s\nhello$/u);
  });

  test("a non-zero exit is a normal failed result, not an error", async () => {
    const runner = scriptedRunner({ steps: [err("boom\n")], exit: { code: 2, signal: null } });
    const result = await createBashTool({ runner })({ command: "false" });
    expect(result.status).toBe("failed");
    expect(result.error).toBeNull();
    expect(text(result).split("\n")[0]).toStartWith("Exit code 2 ·");
    expect(text(result)).toContain("boom");
  });

  test("stdout and stderr merge in arrival order", async () => {
    const runner = scriptedRunner({ steps: [out("a\n"), err("b\n"), out("c\n")] });
    const result = await createBashTool({ runner })({ command: "x" });
    expect(result.output?.head).toBe("a\nb\nc");
    expect(result.output?.stdoutBytes).toBe(4);
    expect(result.output?.stderrBytes).toBe(2);
  });

  test("no output says so", async () => {
    const result = await createBashTool({ runner: scriptedRunner() })({ command: "true" });
    expect(text(result).split("\n")[1]).toBe("(no output)");
  });

  test("a signal exit names the signal", async () => {
    const runner = scriptedRunner({ exit: { code: null, signal: "SIGSEGV" } });
    const result = await createBashTool({ runner })({ command: "x" });
    expect(result.status).toBe("failed");
    expect(text(result)).toStartWith("Ended by SIGSEGV");
  });

  test("a timeout stops the run and keeps the output so far", async () => {
    const runner = scriptedRunner({ steps: [out("partial\n")], hang: true });
    const result = await createBashTool({ runner })({ command: "sleep", timeoutMs: 50 });
    expect(result.status).toBe("timeout");
    expect(result.run?.stoppedBy).toBe("timeout");
    expect(runner.requests[0]?.signal.aborted).toBe(true);
    expect(text(result)).toStartWith(
      "Timed out after 0.1 s. The process tree was stopped.\npartial",
    );
  });

  test("the caller's abort stops the run and returns aborted with the output so far", async () => {
    const runner = scriptedRunner({ steps: [out("so far\n")], hang: true });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const result = await createBashTool({ runner })(
      { command: "sleep" },
      { signal: controller.signal },
    );
    expect(result.status).toBe("aborted");
    expect(result.output?.head).toBe("so far");
    expect(text(result)).toStartWith("Aborted after");
  });

  test("an abort before the start never calls the runner", async () => {
    const runner = scriptedRunner();
    const controller = new AbortController();
    controller.abort();
    const result = await createBashTool({ runner })(
      { command: "x" },
      { signal: controller.signal },
    );
    expect(result.status).toBe("aborted");
    expect(result.run).toBeNull();
    expect(runner.requests).toHaveLength(0);
  });

  test("a runner that ignores the stop gives up after the grace time with a warning", async () => {
    const runner = scriptedRunner({ hang: true, ignoreStop: true });
    const bash = createBashTool({ runner, limits: { killGraceMs: 10 } });
    const started = Date.now();
    const result = await bash({ command: "x", timeoutMs: 20 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.status).toBe("timeout");
    expect(result.run?.unconfirmedStop).toBe(true);
    expect(result.notes.map((note) => note.code)).toContain("UNCONFIRMED_STOP");
  });

  test("past maxCaptureBytes the core stops the command with OUTPUT_CAP", async () => {
    const big = "x".repeat(1_000);
    const runner = scriptedRunner({
      steps: Array.from({ length: 50 }, () => out(big)),
      hang: true,
    });
    const bash = createBashTool({ runner, limits: { maxCaptureBytes: 10_000 } });
    const result = await bash({ command: "yes" });
    expect(result.status).toBe("error");
    expect(result.error).toEqual({ code: "OUTPUT_CAP", phase: "run" });
    expect(result.run?.stoppedBy).toBe("output-cap");
    expect(text(result)).toContain("[bash:OUTPUT_CAP]");
  });
});

describe("input", () => {
  test("a blank command is INVALID_INPUT", async () => {
    const result = await createBashTool({ runner: scriptedRunner() })({ command: "  " });
    expect(result.status).toBe("error");
    expect(result.error).toEqual({ code: "INVALID_INPUT", phase: "input" });
    expect(result.request).toBeNull();
  });

  test("an unknown key is INVALID_INPUT", async () => {
    const bash = createBashTool({ runner: scriptedRunner() });
    const result = await bash({ command: "x", extra: 1 } as never);
    expect(result.error?.code).toBe("INVALID_INPUT");
  });

  test("a timeout over the maximum is cut, with a note", async () => {
    const runner = scriptedRunner();
    const bash = createBashTool({ runner, limits: { maxTimeoutMs: 1_000, defaultTimeoutMs: 500 } });
    const result = await bash({ command: "x", timeoutMs: 5_000 });
    expect(result.request?.timeoutMs).toBe(1_000);
    expect(result.notes[0]?.code).toBe("TIMEOUT_CLAMPED");
  });

  test("the default timeout applies when none is given", async () => {
    const result = await createBashTool({ runner: scriptedRunner() })({ command: "x" });
    expect(result.request?.timeoutMs).toBe(120_000);
  });
});

describe("cwd", () => {
  test("defaults to the runner's cwd and resolves a relative cwd against it", async () => {
    const runner = scriptedRunner({}, "/work");
    const bash = createBashTool({ runner });
    await bash({ command: "x" });
    await bash({ command: "x", cwd: "sub/../pkg" });
    expect(runner.requests.map((request) => request.cwd)).toEqual(["/work", "/work/pkg"]);
  });

  test("the cwd dependency replaces the runner's cwd", async () => {
    const runner = scriptedRunner({}, "/work");
    await createBashTool({ runner, cwd: () => "/other" })({ command: "x" });
    expect(runner.requests[0]?.cwd).toBe("/other");
  });

  test("a resolver changes the requested string first", async () => {
    const runner = scriptedRunner({}, "/work");
    const bash = createBashTool({
      runner,
      resolve: {
        id: "strip",
        resolve: (path) => ({ kind: "path", path: path.replace("~", "/home") }),
      },
    });
    await bash({ command: "x", cwd: "~/a" });
    expect(runner.requests[0]?.cwd).toBe("/home/a");
  });

  test("a resolver not-found gives CWD_NOT_FOUND", async () => {
    const bash = createBashTool({
      runner: scriptedRunner(),
      resolve: { id: "none", resolve: () => ({ kind: "not-found" }) },
    });
    const result = await bash({ command: "x", cwd: "gone" });
    expect(result.error).toEqual({ code: "CWD_NOT_FOUND", phase: "resolve" });
  });

  test("a runner start error maps to CWD_NOT_A_DIRECTORY", async () => {
    const runner = scriptedRunner({
      exit: { code: null, signal: null, error: { reason: "cwd-not-a-directory" } },
    });
    const result = await createBashTool({ runner })({ command: "x", cwd: "file.txt" });
    expect(result.error).toEqual({ code: "CWD_NOT_A_DIRECTORY", phase: "run" });
    expect(result.run).toBeNull();
  });

  test("a runner that throws on start gives SPAWN_FAILED", async () => {
    const runner = {
      id: "broken",
      cwd: "/",
      run: () => {
        throw new Error("no shell");
      },
    };
    const result = await createBashTool({ runner })({ command: "x" });
    expect(result.error).toEqual({ code: "SPAWN_FAILED", phase: "run" });
    expect(text(result)).toContain("no shell");
  });
});

describe("hooks", () => {
  test("authorize deny gives DENIED with the authorizer's note", async () => {
    const runner = scriptedRunner();
    const bash = createBashTool({
      runner,
      authorize: {
        id: "no-rm",
        authorize: (target) =>
          target.command.startsWith("rm")
            ? { allow: false, note: { code: "NO_RM", severity: "warning", message: "No rm." } }
            : { allow: true },
      },
    });
    const denied = await bash({ command: "rm -rf x" });
    expect(denied.status).toBe("refused");
    expect(denied.error).toEqual({ code: "DENIED", phase: "authorize" });
    expect(text(denied)).toBe("[bash:NO_RM] No rm.");
    expect(runner.requests).toHaveLength(0);
    expect((await bash({ command: "ls" })).status).toBe("ok");
  });

  test("authorize sees the cwd as the path fields", async () => {
    const seen: unknown[] = [];
    const bash = createBashTool({
      runner: scriptedRunner({}, "/work"),
      authorize: {
        id: "spy",
        authorize: (target) => {
          seen.push({ ...target });
          return { allow: true };
        },
      },
    });
    await bash({ command: "ls", cwd: "src" });
    expect(seen).toEqual([
      {
        action: "run",
        requestedPath: "src",
        resolvedPath: "/work/src",
        displayPath: "/work/src",
        command: "ls",
        cwd: "/work/src",
        timeoutMs: 120_000,
      },
    ]);
  });

  test("beforeRun can refuse", async () => {
    const runner = scriptedRunner();
    const bash = createBashTool({
      runner,
      beforeRun: [
        {
          id: "no-vim",
          beforeRun: () => ({
            kind: "refuse",
            note: { code: "INTERACTIVE", severity: "warning", message: "vim needs a terminal." },
          }),
        },
      ],
    });
    const result = await bash({ command: "vim" });
    expect(result.status).toBe("refused");
    expect(result.error).toEqual({ code: "REFUSED", phase: "beforeRun" });
    expect(runner.requests).toHaveLength(0);
  });

  test("beforeRun rewrites feed the next hook and the runner", async () => {
    const runner = scriptedRunner();
    const seen: string[] = [];
    const bash = createBashTool({
      runner,
      beforeRun: [
        { id: "a", beforeRun: (run) => ({ kind: "continue", command: `${run.command} | head` }) },
        {
          id: "b",
          beforeRun: (run) => {
            seen.push(run.command);
            return { kind: "continue", notes: [{ code: "B", severity: "info", message: "b" }] };
          },
        },
      ],
    });
    const result = await bash({ command: "cat x" });
    expect(seen).toEqual(["cat x | head"]);
    expect(runner.requests[0]?.command).toBe("cat x | head");
    expect(result.run?.command).toBe("cat x | head");
    expect(result.notes.map((note) => note.code)).toEqual(["B"]);
  });

  test("the default env is defaultShellEnv only; env replaces it", async () => {
    const runner = scriptedRunner();
    await createBashTool({ runner })({ command: "x" });
    expect(runner.requests[0]?.env).toEqual(defaultShellEnv);
    await createBashTool({ runner, env: () => ({ A: "1" }) })({ command: "x" });
    expect(runner.requests[1]?.env).toEqual({ A: "1" });
  });

  test("afterRun may change the output and add notes, but not the status", async () => {
    const runner = scriptedRunner({ steps: [out("token=abc\n")], exit: { code: 1, signal: null } });
    const bash = createBashTool({
      runner,
      afterRun: [
        {
          id: "mask",
          afterRun: (outcome: RunOutcome): RunOutcome => ({
            ...outcome,
            status: "ok",
            output: { ...outcome.output, head: outcome.output.head.replace("abc", "***") },
            notes: [...outcome.notes, { code: "MASKED", severity: "info", message: "Masked." }],
          }),
        },
      ],
    });
    const result = await bash({ command: "env" });
    expect(result.status).toBe("failed");
    expect(result.output?.head).toBe("token=***");
    expect(text(result)).toContain("[bash:MASKED] Masked.");
  });

  test("a throwing hook gives EXTENSION_FAILED at its phase", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    const runner = scriptedRunner({ steps: [out("kept\n")] });
    const cases = [
      [{ authorize: { id: "auth", authorize: boom } }, "authorize"],
      [{ beforeRun: [{ id: "before", beforeRun: boom }] }, "beforeRun"],
      [{ env: boom }, "env"],
      [{ afterRun: [{ id: "after", afterRun: boom }] }, "afterRun"],
      [{ formatter: { id: "fmt", format: boom } }, "format"],
      [{ spill: { id: "spill", open: async () => boom() } }, "spill"],
      [{ resolve: { id: "res", resolve: boom } }, "resolve"],
    ] as const;
    for (const [deps, phase] of cases) {
      const result = await createBashTool({ runner, ...deps })({ command: "x", cwd: "." });
      expect(result.status).toBe("error");
      expect(result.error).toEqual({ code: "EXTENSION_FAILED", phase });
      expect(text(result)).toContain("[bash:EXTENSION_FAILED]");
    }
  });

  test("afterRun failure keeps the run and the output", async () => {
    const runner = scriptedRunner({ steps: [out("kept\n")] });
    const bash = createBashTool({
      runner,
      afterRun: [{ id: "after", afterRun: () => ({}) as never }],
    });
    const result = await bash({ command: "x" });
    expect(result.run?.exitCode).toBe(0);
    expect(text(result)).toContain("kept");
    expect(text(result)).toContain("The after extension failed during the afterRun phase.");
  });

  test("spill receives every byte and its reference goes into the truncation note", async () => {
    const received: number[] = [];
    const runner = scriptedRunner({
      steps: Array.from({ length: 100 }, (_, index) => out(`row ${index}\n`)),
    });
    const bash = createBashTool({
      runner,
      limits: { maxOutputLines: 10 },
      spill: {
        id: "memory",
        open: async () => ({
          write: async (bytes) => {
            received.push(bytes.byteLength);
          },
          close: async () => "/tmp/out.log",
        }),
      },
    });
    const result = await bash({ command: "seq" });
    expect(received.reduce((sum, value) => sum + value, 0)).toBe(result.output?.totalBytes ?? -1);
    expect(result.output?.spill).toBe("/tmp/out.log");
    expect(text(result)).toContain("not shown] Full output: /tmp/out.log");
  });

  test("a failing spill write adds a warning and does not change the run", async () => {
    const runner = scriptedRunner({ steps: [out("a\n")] });
    const bash = createBashTool({
      runner,
      spill: {
        id: "disk",
        open: async () => ({
          write: async () => {
            throw new Error("full");
          },
          close: async () => "/x",
        }),
      },
    });
    const result = await bash({ command: "x" });
    expect(result.status).toBe("ok");
    expect(result.output?.spill).toBeNull();
    expect(result.notes.map((note) => note.code)).toEqual(["SPILL_FAILED"]);
  });
});

describe("output stream failures", () => {
  function runnerWith(output: AsyncIterable<unknown>): CommandRunner {
    return {
      id: "broken",
      cwd: "/work",
      run: () => ({
        output: output as AsyncIterable<OutputChunk>,
        exit: Promise.resolve({ code: 0, signal: null }),
      }),
    };
  }

  test("an output stream that throws gives an OUTPUT_INCOMPLETE warning", async () => {
    const runner = runnerWith({
      async *[Symbol.asyncIterator]() {
        yield out("partial\n");
        throw new Error("lost output");
      },
    });
    const result = await createBashTool({ runner })({ command: "x" });
    expect(result.status).toBe("ok");
    expect(result.output?.head).toBe("partial");
    expect(result.notes).toEqual([
      {
        code: "OUTPUT_INCOMPLETE",
        severity: "warning",
        message:
          "The output may be incomplete: the output stream failed (lost output). The exit status is still the command's.",
        data: { skippedChunks: 0, detail: "lost output" },
      },
    ]);
    expect(text(result)).toContain("[bash:OUTPUT_INCOMPLETE]");
  });

  test("an output stream that throws before any chunk does not read as clean empty output", async () => {
    const runner = runnerWith({
      // oxlint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error("lost output");
      },
    });
    const result = await createBashTool({ runner })({ command: "x" });
    expect(result.notes.map((note) => note.code)).toEqual(["OUTPUT_INCOMPLETE"]);
  });

  test("malformed chunks are skipped and counted", async () => {
    const runner = runnerWith({
      async *[Symbol.asyncIterator]() {
        yield out("a\n");
        yield { stream: "stdout", bytes: "not bytes" };
        yield null;
        yield out("b\n");
      },
    });
    const result = await createBashTool({ runner })({ command: "x" });
    expect(result.output?.head).toBe("a\nb");
    expect(result.notes).toMatchObject([{ code: "OUTPUT_INCOMPLETE", data: { skippedChunks: 2 } }]);
    expect(result.notes[0]?.message).toContain("2 malformed output chunks, which were skipped");
  });
});

describe("createBashTool", () => {
  test("throws TypeError on a missing runner, an unknown key, or a bad limit", () => {
    expect(() => createBashTool({} as never)).toThrow(TypeError);
    expect(() => createBashTool({ runner: scriptedRunner(), extra: 1 } as never)).toThrow(
      "Unknown bash tool dependency: extra",
    );
    expect(() =>
      createBashTool({ runner: scriptedRunner(), limits: { headPercent: 101 } }),
    ).toThrow(TypeError);
    expect(() => createBashTool({ runner: scriptedRunner(), cwd: "relative" })).toThrow(TypeError);
  });

  test("a runner factory runs for each call", async () => {
    const runner = scriptedRunner();
    let calls = 0;
    const bash = createBashTool<{ id: number }>({
      runner: (call) => {
        calls += call.host.id;
        return runner;
      },
    });
    await bash({ command: "x" }, { host: { id: 1 } });
    await bash({ command: "x" }, { host: { id: 2 } });
    expect(calls).toBe(3);
  });
});
