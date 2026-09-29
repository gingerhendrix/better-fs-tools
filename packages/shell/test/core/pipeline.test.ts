import { describe, expect, jest, test } from "bun:test";

import { createBashTool, defaultShellEnv, parseBashInput, shellEnv } from "@better-fs-tools/shell";
import type {
  CommandRunner,
  OutputChunk,
  RunOutcome,
  ShellHookContext,
} from "@better-fs-tools/shell";

import { resolveShellLimits } from "@better-fs-tools/shell";

import { bashTool, err, errorOf, out, scriptedRunner, text } from "../helpers.ts";

const createLimits = () => resolveShellLimits();

const anyMessage = expect.any(String) as unknown as string;

describe("statuses", () => {
  test("exit 0 is ok, with the exit code first in the text", async () => {
    const bash = bashTool({ runner: scriptedRunner({ steps: [out("hello\n")] }) });
    const result = await bash({ command: "echo hello" });
    expect(result.status).toBe("ok");
    expect("error" in result).toBe(false);
    expect(result.run?.exitCode).toBe(0);
    expect(text(result)).toMatch(/^Exit code 0 · \d+(\.\d)? s\nhello$/u);
  });

  test("a non-zero exit is a normal failed result, not an error", async () => {
    const runner = scriptedRunner({ steps: [err("boom\n")], exit: { code: 2, signal: null } });
    const result = await bashTool({ runner })({ command: "false" });
    expect(result.status).toBe("failed");
    expect("error" in result).toBe(false);
    expect(text(result).split("\n")[0]).toStartWith("Exit code 2 ·");
    expect(text(result)).toContain("boom");
  });

  test("stdout and stderr merge in arrival order", async () => {
    const runner = scriptedRunner({ steps: [out("a\n"), err("b\n"), out("c\n")] });
    const result = await bashTool({ runner })({ command: "x" });
    expect(result.output?.head).toBe("a\nb\nc");
    expect(result.output?.stdoutBytes).toBe(4);
    expect(result.output?.stderrBytes).toBe(2);
  });

  test("no output says so", async () => {
    const result = await bashTool({ runner: scriptedRunner() })({ command: "true" });
    expect(text(result).split("\n")[1]).toBe("(no output)");
  });

  test("a signal exit names the signal", async () => {
    const runner = scriptedRunner({ exit: { code: null, signal: "SIGSEGV" } });
    const result = await bashTool({ runner })({ command: "x" });
    expect(result.status).toBe("failed");
    expect(text(result)).toStartWith("Ended by SIGSEGV");
  });

  test("a timeout stops the run and keeps the output so far", async () => {
    const runner = scriptedRunner({ steps: [out("partial\n")], hang: true });
    const result = await bashTool({ runner })({ command: "sleep", timeoutMs: 50 });
    expect(result.status).toBe("timeout");
    expect(result.run?.stoppedBy).toBe("timeout");
    expect(runner.requests[0]?.signal.aborted).toBe(true);
    expect(text(result)).toStartWith(
      "Timed out after 0.1 s. The process tree was stopped.\npartial",
    );
  });

  test("the caller's abort stops the run and returns ABORTED with the output so far", async () => {
    const runner = scriptedRunner({ steps: [out("so far\n")], hang: true });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    const result = await bashTool({ runner })({ command: "sleep" }, { signal: controller.signal });
    expect(result.status).toBe("error");
    expect(errorOf(result)).toEqual({ code: "ABORTED", phase: "run", message: anyMessage });
    expect(result.run?.stoppedBy).toBe("abort");
    expect(result.output?.head).toBe("so far");
    expect(text(result)).toContain("[bash:aborted] Aborted after");
  });

  test("an abort before the start never calls the runner", async () => {
    const runner = scriptedRunner();
    const controller = new AbortController();
    controller.abort();
    const result = await bashTool({ runner })({ command: "x" }, { signal: controller.signal });
    expect(result.status).toBe("error");
    // The default env is the first host call, and it sees the abort.
    expect(errorOf(result)).toEqual({ code: "ABORTED", phase: "env", message: anyMessage });
    expect(result.notes.map((note) => note.code)).toEqual(["aborted"]);
    expect(result.run).toBeNull();
    expect(runner.requests).toHaveLength(0);
  });

  test("a runner that ignores the stop gives up after the grace time with a warning", async () => {
    const runner = scriptedRunner({ hang: true, ignoreStop: true });
    const bash = bashTool({ runner, limits: { killGraceMs: 10 } });
    const started = Date.now();
    const result = await bash({ command: "x", timeoutMs: 20 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result.status).toBe("timeout");
    expect(result.run?.unconfirmedStop).toBe(true);
    expect(result.notes.map((note) => note.code)).toContain("unconfirmed-stop");
  });

  test("past maxCaptureBytes the core stops the command with OUTPUT_CAP", async () => {
    const big = "x".repeat(1_000);
    const runner = scriptedRunner({
      steps: Array.from({ length: 50 }, () => out(big)),
      hang: true,
    });
    const bash = bashTool({ runner, limits: { maxCaptureBytes: 10_000 } });
    const result = await bash({ command: "yes" });
    expect(result.status).toBe("error");
    expect(errorOf(result)).toEqual({ code: "OUTPUT_CAP", phase: "run", message: anyMessage });
    expect(result.run?.stoppedBy).toBe("output-cap");
    expect(text(result)).toContain("[bash:output-cap]");
  });
});

describe("input", () => {
  test("a blank command is INVALID_INPUT", async () => {
    const result = await bashTool({ runner: scriptedRunner() })({ command: "  " });
    expect(result.status).toBe("error");
    expect(errorOf(result)).toEqual({ code: "INVALID_INPUT", phase: "input", message: anyMessage });
    expect(result.notes.map((note) => note.code)).toEqual(["invalid-input"]);
    expect(result.request).toBeNull();
  });

  test("an unknown key is INVALID_INPUT", async () => {
    const bash = bashTool({ runner: scriptedRunner() });
    const result = await bash({ command: "x", extra: 1 } as never);
    expect(errorOf(result)?.code).toBe("INVALID_INPUT");
  });

  test("a timeout over the maximum is cut, with a clamped info note", async () => {
    const runner = scriptedRunner();
    const bash = bashTool({ runner, limits: { maxTimeoutMs: 1_000, defaultTimeoutMs: 500 } });
    const result = await bash({ command: "x", timeoutMs: 5_000 });
    expect(result.request?.timeoutMs).toBe(1_000);
    expect(result.notes[0]).toEqual({
      code: "clamped",
      severity: "info",
      message: "The requested timeout of 5 s is over the maximum, so 1 s was used.",
      data: { param: "timeoutMs", requested: 5_000, max: 1_000 },
    });
  });

  test("a timeout at the maximum gives no note", async () => {
    const bash = bashTool({
      runner: scriptedRunner(),
      limits: { maxTimeoutMs: 1_000, defaultTimeoutMs: 500 },
    });
    const result = await bash({ command: "x", timeoutMs: 999.5 });
    expect(result.request?.timeoutMs).toBe(1_000);
    expect(result.notes).toEqual([]);
  });

  test("parseBashInput returns the request and throws TypeError, like the other parse helpers", () => {
    const limits = { ...createLimits(), maxTimeoutMs: 1_000 };
    expect(parseBashInput({ command: "ls", timeoutMs: 5_000 }, limits)).toEqual({
      command: "ls",
      timeoutMs: 1_000,
      cwd: null,
    });
    expect(() => parseBashInput({ command: " " }, limits)).toThrow(TypeError);
    expect(() => parseBashInput({ command: "ls", extra: 1 }, limits)).toThrow(TypeError);
  });

  test("the default timeout applies when none is given", async () => {
    const result = await bashTool({ runner: scriptedRunner() })({ command: "x" });
    expect(result.request?.timeoutMs).toBe(120_000);
  });
});

describe("cwd", () => {
  test("defaults to the runner's cwd and resolves a relative cwd against it", async () => {
    const runner = scriptedRunner({}, "/work");
    const bash = bashTool({ runner });
    await bash({ command: "x" });
    await bash({ command: "x", cwd: "sub/../pkg" });
    expect(runner.requests.map((request) => request.cwd)).toEqual(["/work", "/work/pkg"]);
  });

  test("the cwd dependency replaces the runner's cwd", async () => {
    const runner = scriptedRunner({}, "/work");
    await bashTool({ runner, cwd: () => "/other" })({ command: "x" });
    expect(runner.requests[0]?.cwd).toBe("/other");
  });

  test("a resolver changes the requested string first", async () => {
    const runner = scriptedRunner({}, "/work");
    const bash = bashTool({
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
    const bash = bashTool({
      runner: scriptedRunner(),
      resolve: { id: "none", resolve: () => ({ kind: "not-found" }) },
    });
    const result = await bash({ command: "x", cwd: "gone" });
    expect(errorOf(result)).toEqual({
      code: "CWD_NOT_FOUND",
      phase: "resolve",
      message: anyMessage,
    });
  });

  test("a runner start error maps to CWD_NOT_A_DIRECTORY", async () => {
    const runner = scriptedRunner({
      exit: { code: null, signal: null, error: { reason: "cwd-not-a-directory" } },
    });
    const result = await bashTool({ runner })({ command: "x", cwd: "file.txt" });
    expect(errorOf(result)).toEqual({
      code: "CWD_NOT_A_DIRECTORY",
      phase: "run",
      message: anyMessage,
    });
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
    const result = await bashTool({ runner })({ command: "x" });
    expect(errorOf(result)).toEqual({ code: "SPAWN_FAILED", phase: "run", message: anyMessage });
    expect(text(result)).toContain("no shell");
  });
});

describe("hooks", () => {
  test("authorize deny gives DENIED with the authorizer's note", async () => {
    const runner = scriptedRunner();
    const bash = bashTool({
      runner,
      authorize: {
        id: "no-rm",
        authorize: (target) =>
          target.command.startsWith("rm")
            ? { allow: false, note: { code: "no-rm", severity: "warning", message: "No rm." } }
            : { allow: true },
      },
    });
    const denied = await bash({ command: "rm -rf x" });
    expect(denied.status).toBe("error");
    expect(errorOf(denied)).toEqual({ code: "DENIED", phase: "authorize", message: "No rm." });
    expect(text(denied)).toBe("[bash:no-rm] No rm.");
    expect(runner.requests).toHaveLength(0);
    expect((await bash({ command: "ls" })).status).toBe("ok");
  });

  test("authorize without a note gives a denied note", async () => {
    const bash = bashTool({
      runner: scriptedRunner({}, "/work"),
      authorize: { id: "no", authorize: () => ({ allow: false }) },
    });
    const result = await bash({ command: "ls" });
    expect(result.notes).toEqual([
      {
        code: "denied",
        severity: "warning",
        message: "The command in /work was refused by policy.",
      },
    ]);
  });

  test("authorize sees the cwd as the path fields, with a relative display path", async () => {
    const seen: unknown[] = [];
    const bash = bashTool({
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
        displayPath: "src",
        command: "ls",
        cwd: "/work/src",
        timeoutMs: 120_000,
      },
    ]);
  });

  test("the display path is . for the default cwd, and ../ outside it", async () => {
    const seen: string[] = [];
    const bash = bashTool({
      runner: scriptedRunner({}, "/work/app"),
      authorize: {
        id: "spy",
        authorize: (target) => {
          seen.push(target.displayPath);
          return { allow: true };
        },
      },
    });
    await bash({ command: "ls" });
    await bash({ command: "ls", cwd: "/work/lib/x" });
    await bash({ command: "ls", cwd: "/" });
    expect(seen).toEqual([".", "../lib/x", "../.."]);
  });

  test("beforeRun can refuse", async () => {
    const runner = scriptedRunner();
    const bash = bashTool({
      runner,
      beforeRun: [
        {
          id: "no-vim",
          beforeRun: () => ({
            allow: false,
            note: { code: "interactive", severity: "warning", message: "vim needs a terminal." },
          }),
        },
      ],
    });
    const result = await bash({ command: "vim" });
    expect(result.status).toBe("error");
    expect(errorOf(result)).toEqual({
      code: "REFUSED",
      phase: "beforeRun",
      message: "vim needs a terminal.",
    });
    expect(runner.requests).toHaveLength(0);
  });

  test("a beforeRun refusal without a note gets a refused note", async () => {
    const bash = bashTool({
      runner: scriptedRunner(),
      beforeRun: [{ id: "no", beforeRun: () => ({ allow: false }) }],
    });
    const result = await bash({ command: "x" });
    expect(result.notes).toEqual([
      { code: "refused", severity: "warning", message: "The command was refused by the no check." },
    ]);
  });

  test("authorize runs after beforeRun and sees the rewritten command", async () => {
    const order: string[] = [];
    const runner = scriptedRunner();
    const bash = bashTool({
      runner,
      beforeRun: [
        {
          id: "wrap",
          beforeRun: (run) => {
            order.push("beforeRun");
            return { allow: true, command: `timeout 5 ${run.command}` };
          },
        },
      ],
      authorize: {
        id: "spy",
        authorize: (target) => {
          order.push(`authorize ${target.command}`);
          return target.command.startsWith("timeout 5 ")
            ? { allow: true }
            : { allow: false, note: { code: "no", severity: "warning", message: "no" } };
        },
      },
    });
    const result = await bash({ command: "make" });
    expect(order).toEqual(["beforeRun", "authorize timeout 5 make"]);
    expect(result.status).toBe("ok");
    expect(runner.requests[0]?.command).toBe("timeout 5 make");
  });

  test("a beforeRun refusal stops the call before authorize", async () => {
    let authorized = false;
    const bash = bashTool({
      runner: scriptedRunner(),
      beforeRun: [{ id: "no", beforeRun: () => ({ allow: false }) }],
      authorize: {
        id: "spy",
        authorize: () => {
          authorized = true;
          return { allow: true };
        },
      },
    });
    expect(errorOf(await bash({ command: "x" }))?.code).toBe("REFUSED");
    expect(authorized).toBe(false);
  });

  test("beforeRun rewrites feed the next hook and the runner", async () => {
    const runner = scriptedRunner();
    const seen: string[] = [];
    const bash = bashTool({
      runner,
      beforeRun: [
        { id: "a", beforeRun: (run) => ({ allow: true, command: `${run.command} | head` }) },
        {
          id: "b",
          beforeRun: (run) => {
            seen.push(run.command);
            return { allow: true, notes: [{ code: "b", severity: "info", message: "b" }] };
          },
        },
      ],
    });
    const result = await bash({ command: "cat x" });
    expect(seen).toEqual(["cat x | head"]);
    expect(runner.requests[0]?.command).toBe("cat x | head");
    expect(result.run?.command).toBe("cat x | head");
    expect(result.notes.map((note) => note.code)).toEqual(["b"]);
  });

  test("env is the whole environment: shellEnv() is defaultShellEnv only (Q4)", async () => {
    const runner = scriptedRunner();
    await createBashTool({ runner, env: shellEnv() })({ command: "x" });
    expect(runner.requests[0]?.env).toEqual(defaultShellEnv);
    await createBashTool({ runner, env: () => ({ A: "1" }) })({ command: "x" });
    expect(runner.requests[1]?.env).toEqual({ A: "1" });
  });

  test("afterRun returns the output and the notes; the status stays", async () => {
    const runner = scriptedRunner({ steps: [out("token=abc\n")], exit: { code: 1, signal: null } });
    const seen: RunOutcome["status"][] = [];
    const bash = bashTool({
      runner,
      afterRun: [
        {
          id: "mask",
          afterRun: (outcome) => {
            seen.push(outcome.status);
            return {
              output: { ...outcome.output, head: outcome.output.head.replace("abc", "***") },
              notes: [...outcome.notes, { code: "masked", severity: "info", message: "Masked." }],
            };
          },
        },
      ],
    });
    const result = await bash({ command: "env" });
    expect(seen).toEqual(["failed"]);
    expect(result.status).toBe("failed");
    expect(result.output?.head).toBe("token=***");
    expect(text(result)).toContain("[bash:masked] Masked.");
  });

  test("an afterRun field left out keeps its value", async () => {
    const runner = scriptedRunner({ steps: [out("kept\n")] });
    const bash = bashTool({
      runner,
      afterRun: [
        { id: "none", afterRun: () => ({}) },
        {
          id: "notes",
          afterRun: (outcome) => ({
            notes: [...outcome.notes, { code: "seen", severity: "info", message: "seen" }],
          }),
        },
      ],
    });
    const result = await bash({ command: "x" });
    expect(result.status).toBe("ok");
    expect(result.output?.head).toBe("kept");
    expect(result.notes.map((note) => note.code)).toEqual(["seen"]);
  });

  test("afterRun sees the error of a run the core stopped", async () => {
    const seen: unknown[] = [];
    const runner = scriptedRunner({
      steps: Array.from({ length: 5 }, () => out("x".repeat(50))),
      hang: true,
    });
    const bash = bashTool({
      runner,
      limits: { maxCaptureBytes: 100 },
      afterRun: [
        {
          id: "spy",
          afterRun: (outcome) => {
            seen.push(outcome.status === "error" ? outcome.error.code : outcome.status);
            return {};
          },
        },
      ],
    });
    const result = await bash({ command: "yes" });
    expect(seen).toEqual(["OUTPUT_CAP"]);
    expect(errorOf(result)?.code).toBe("OUTPUT_CAP");
  });

  test("host functions get the digest and the clock from the dependencies", async () => {
    const digest = { id: "d", create: () => ({ update() {}, digest: () => "" }), hash: () => "h" };
    const at = new Date("2026-09-28T00:00:00.000Z");
    const seen: Pick<ShellHookContext, "digest" | "clock">[] = [];
    const bash = bashTool({
      runner: scriptedRunner(),
      digest,
      clock: () => at,
      authorize: {
        id: "spy",
        authorize: (_target, ctx) => {
          seen.push({ digest: ctx.digest, clock: ctx.clock });
          return { allow: true };
        },
      },
    });
    await bash({ command: "x" });
    expect(seen[0]?.digest).toBe(digest);
    expect(seen[0]?.clock()).toBe(at);
  });

  test("the default digest is null and the default clock is the time now", async () => {
    let ctx: ShellHookContext | null = null;
    await bashTool({
      runner: scriptedRunner(),
      beforeRun: [
        {
          id: "spy",
          beforeRun: (_run, hookCtx) => {
            ctx = hookCtx;
            return { allow: true };
          },
        },
      ],
    })({ command: "x" });
    expect((ctx as ShellHookContext | null)?.digest).toBeNull();
    expect((ctx as ShellHookContext | null)?.clock()).toBeInstanceOf(Date);
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
      [{ spill: { id: "spill", open: async () => boom() } }, "spill"],
      [{ resolve: { id: "res", resolve: boom } }, "resolve"],
    ] as const;
    for (const [deps, phase] of cases) {
      const result = await bashTool({ runner, ...deps })({ command: "x", cwd: "." });
      expect(result.status).toBe("error");
      expect(errorOf(result)).toEqual({ code: "EXTENSION_FAILED", phase, message: anyMessage });
      expect(text(result)).toContain("[bash:extension-failed]");
    }
  });

  test("a formatter that fails keeps the status and adds an extension-failed warning", async () => {
    const runner = scriptedRunner({ steps: [out("kept\n")] });
    const cases = [
      () => {
        throw new Error("boom");
      },
      () => 42 as never,
    ];
    for (const format of cases) {
      const result = await bashTool({ runner, formatter: { id: "fmt", format } })({
        command: "x",
      });
      expect(result.status).toBe("ok");
      expect("error" in result).toBe(false);
      expect(result.notes).toEqual([
        {
          code: "extension-failed",
          severity: "warning",
          message:
            "The fmt extension failed during the format phase. This is a host problem, not a problem with the command.",
          data: { extension: "formatter", id: "fmt" },
        },
      ]);
      expect(text(result)).toStartWith("Exit code 0");
      expect(text(result)).toContain("kept");
      expect(text(result)).toContain("[bash:extension-failed]");
    }
  });

  test("afterRun failure keeps the run and the output", async () => {
    const runner = scriptedRunner({ steps: [out("kept\n")] });
    const bash = bashTool({
      runner,
      afterRun: [{ id: "after", afterRun: () => ({ output: "not a view" }) as never }],
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
    const bash = bashTool({
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
    const bash = bashTool({
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
    expect(result.notes.map((note) => note.code)).toEqual(["spill-failed"]);
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

  test("an output stream that throws gives an output-incomplete warning", async () => {
    const runner = runnerWith({
      async *[Symbol.asyncIterator]() {
        yield out("partial\n");
        throw new Error("lost output");
      },
    });
    const result = await bashTool({ runner })({ command: "x" });
    expect(result.status).toBe("ok");
    expect(result.output?.head).toBe("partial");
    expect(result.notes).toEqual([
      {
        code: "output-incomplete",
        severity: "warning",
        message:
          "The output may be incomplete: the output stream failed (lost output). The exit status is still the command's.",
        data: { skippedChunks: 0, detail: "lost output" },
      },
    ]);
    expect(text(result)).toContain("[bash:output-incomplete]");
  });

  test("an output stream that throws before any chunk does not read as clean empty output", async () => {
    const runner = runnerWith({
      // oxlint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error("lost output");
      },
    });
    const result = await bashTool({ runner })({ command: "x" });
    expect(result.notes.map((note) => note.code)).toEqual(["output-incomplete"]);
  });

  /** Runs `call` with fake timers, moving time on in steps until it settles. */
  async function withFakeTime<T>(call: () => Promise<T>, stepMs: number): Promise<T> {
    jest.useFakeTimers();
    try {
      let settled = false;
      const pending = call().finally(() => {
        settled = true;
      });
      for (let step = 0; step < 200 && !settled; step++) {
        for (let tick = 0; tick < 20; tick++) await Promise.resolve();
        jest.advanceTimersByTime(stepMs);
      }
      return await pending;
    } finally {
      jest.useRealTimers();
    }
  }

  test("an output stream that has not ended at the drain deadline gives output-incomplete", async () => {
    let late: (() => void) | undefined;
    const runner = runnerWith({
      async *[Symbol.asyncIterator]() {
        yield out("early\n");
        // A background child holds the stream open past the exit and the drain deadline.
        await new Promise<void>((resolve) => {
          late = resolve;
        });
        yield out("late\n");
      },
    });
    const result = await withFakeTime(() => bashTool({ runner })({ command: "x" }), 100);
    late?.();
    expect(result.status).toBe("ok");
    expect(result.output?.head).toBe("early");
    expect(result.notes).toEqual([
      {
        code: "output-incomplete",
        severity: "warning",
        message:
          "The output may be incomplete: the output had not ended 1000 ms after the command exited. The exit status is still the command's.",
        data: { skippedChunks: 0, drainMs: 1000 },
      },
    ]);
  });

  test("a stream that ends within the drain deadline gives no note", async () => {
    const runner = runnerWith({
      async *[Symbol.asyncIterator]() {
        yield out("a\n");
        await new Promise((resolve) => setTimeout(resolve, 500));
        yield out("b\n");
      },
    });
    const result = await withFakeTime(() => bashTool({ runner })({ command: "x" }), 100);
    expect(result.output?.head).toBe("a\nb");
    expect(result.notes).toEqual([]);
  });

  test("a stop the tool started does not add output-incomplete for the unfinished stream", async () => {
    const runner: CommandRunner = {
      id: "hang",
      cwd: "/work",
      run: (request) => ({
        output: (async function* () {
          yield out("x\n");
          await new Promise(() => {});
        })(),
        exit: new Promise((resolve) => {
          request.signal.addEventListener("abort", () =>
            resolve({ code: null, signal: "SIGTERM" }),
          );
        }),
      }),
    };
    const result = await withFakeTime(
      () => bashTool({ runner })({ command: "x", timeoutMs: 200 }),
      100,
    );
    expect(result.status).toBe("timeout");
    expect(result.notes.map((note) => note.code)).not.toContain("output-incomplete");
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
    const result = await bashTool({ runner })({ command: "x" });
    expect(result.output?.head).toBe("a\nb");
    expect(result.notes).toMatchObject([{ code: "output-incomplete", data: { skippedChunks: 2 } }]);
    expect(result.notes[0]?.message).toContain("2 malformed output chunks, which were skipped");
  });
});

describe("createBashTool", () => {
  test("throws TypeError on a missing runner, an unknown key, or a bad limit", () => {
    expect(() => bashTool({} as never)).toThrow(TypeError);
    expect(() => bashTool({ runner: scriptedRunner(), extra: 1 } as never)).toThrow(
      "Unknown bash tool dependency: extra",
    );
    expect(() => bashTool({ runner: scriptedRunner(), limits: { headPercent: 101 } })).toThrow(
      TypeError,
    );
    expect(() => bashTool({ runner: scriptedRunner(), cwd: "relative" })).toThrow(TypeError);
  });

  test("env is required: no silent defaultShellEnv-only environment (Q4)", () => {
    const runner = scriptedRunner();
    // @ts-expect-error: env is a required dependency.
    expect(() => createBashTool({ runner })).toThrow(
      "env is required: pass shellEnv(() => process.env), an allow list such as shellEnv({ PATH }), or shellEnv()",
    );
    expect(() => createBashTool({ runner, env: undefined as never })).toThrow("env is required");
    expect(() => createBashTool({ runner, env: "PATH=/bin" as never })).toThrow(
      "env must be a function",
    );
  });

  test("a runner factory runs for each call", async () => {
    const runner = scriptedRunner();
    let calls = 0;
    const bash = bashTool<{ id: number }>({
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
