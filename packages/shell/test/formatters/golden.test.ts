import { describe, expect, test } from "bun:test";

import {
  defaultShellFormatter,
  resolveShellLimits,
  resolveShellMessages,
} from "@better-fs-tools/shell";
import type { ShellOutput, ShellReport, ShellRun } from "@better-fs-tools/shell";

const context = {
  digest: null,
  limits: resolveShellLimits(),
  messages: resolveShellMessages(),
  mode: "model" as const,
  call: { host: undefined },
};
const format = (report: ShellReport, mode: "model" | "view" = "model") =>
  defaultShellFormatter().format(report, { ...context, mode });

const run: ShellRun = {
  command: "x",
  cwd: "/w",
  timeoutMs: 120_000,
  exitCode: 0,
  signal: null,
  durationMs: 412,
  stoppedBy: null,
  unconfirmedStop: false,
};
const output: ShellOutput = {
  head: "hello",
  tail: null,
  totalBytes: 6,
  totalLines: 1,
  omittedBytes: 0,
  omittedLines: 0,
  stdoutBytes: 6,
  stderrBytes: 0,
  spill: null,
};
const report = (patch: Record<string, unknown>): ShellReport =>
  ({
    tool: "bash",
    status: "ok",
    request: { command: "x", timeoutMs: 120_000, cwd: null },
    run,
    output,
    notes: [],
    ...patch,
  }) as ShellReport;

describe("defaultShellFormatter golden text", () => {
  test("ok", () => {
    expect(format(report({}))).toBe("Exit code 0 · 0.4 s\nhello");
  });

  test("failed", () => {
    const failed = report({ status: "failed", run: { ...run, exitCode: 1 } });
    expect(format(failed)).toBe("Exit code 1 · 0.4 s\nhello");
  });

  test("timeout with a cut view and a spill reference", () => {
    const cut = report({
      status: "timeout",
      run: { ...run, exitCode: null, signal: "SIGTERM", stoppedBy: "timeout", durationMs: 120_004 },
      output: {
        ...output,
        head: "first",
        tail: "last",
        omittedLines: 11_945,
        omittedBytes: 1_812_345,
        spill: "/tmp/run.log",
      },
    });
    expect(format(cut)).toBe(
      [
        "Timed out after 2 min. The process tree was stopped.",
        "first",
        "[… 11945 lines (1.8 MB) not shown] Full output: /tmp/run.log",
        "last",
      ].join("\n"),
    );
  });

  test("an abort during the run shows the exit, then the aborted note", () => {
    const message = "Aborted after 3.1 s. The process tree was stopped.";
    const aborted = report({
      status: "error",
      error: { code: "ABORTED", phase: "run", message },
      run: { ...run, exitCode: null, signal: "SIGTERM", stoppedBy: "abort", durationMs: 3_100 },
      output: { ...output, head: "", totalBytes: 0, totalLines: 0 },
      notes: [{ code: "aborted", severity: "warning", message }],
    });
    expect(format(aborted)).toBe(
      `Ended by SIGTERM · 3.1 s\n(no output)\n\n[bash:aborted] ${message}`,
    );
  });

  test("an error before the run prints the note only", () => {
    const denied = report({
      status: "error",
      error: { code: "DENIED", phase: "authorize", message: "No." },
      run: null,
      output: null,
      notes: [{ code: "denied", severity: "warning", message: "No." }],
    });
    expect(format(denied)).toBe("[bash:denied] No.");
  });

  test("error after a run shows the run, then the note", () => {
    const capped = report({
      status: "error",
      error: { code: "OUTPUT_CAP", phase: "run", message: "Too much." },
      run: { ...run, exitCode: null, signal: "SIGTERM", stoppedBy: "output-cap" },
      notes: [{ code: "output-cap", severity: "warning", message: "Too much." }],
    });
    expect(format(capped)).toBe("Ended by SIGTERM · 0.4 s\nhello\n\n[bash:output-cap] Too much.");
  });

  test("view mode leaves out the notes", () => {
    const noted = report({ notes: [{ code: "n", severity: "info", message: "n" }] });
    expect(format(noted, "view")).toBe("Exit code 0 · 0.4 s\nhello");
  });
});
