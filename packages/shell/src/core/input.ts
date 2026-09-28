import type { BashRequest } from "../contract/input.ts";
import type { ShellLimits } from "../contract/limits.ts";

/** The input could not be used. The message goes into the INVALID_INPUT note. */
export class InputError extends Error {}

export interface ParsedInput {
  readonly request: BashRequest;
  /** The requested timeout, when it was over the maximum and was cut. */
  readonly clampedFrom: number | null;
}

/**
 * Checks canonical input and fills defaults. `command` must hold a
 * non-whitespace character and no NUL. `timeoutMs` must be a positive finite
 * number. It is rounded up to a whole millisecond and cut to maxTimeoutMs.
 * `cwd` must be a non-blank string without NUL.
 */
export function parseBashInput(input: unknown, limits: Readonly<ShellLimits>): ParsedInput {
  if (!isRecord(input)) throw new InputError("the input must be an object with a command");
  for (const key of Object.keys(input)) {
    if (key !== "command" && key !== "timeoutMs" && key !== "cwd") {
      throw new InputError(`unknown key ${key}. Expected command, timeoutMs, cwd`);
    }
  }
  const { command, timeoutMs, cwd } = input;
  if (typeof command !== "string" || command.trim() === "") {
    throw new InputError("command must be a non-blank string");
  }
  if (command.includes("\u0000")) throw new InputError("command must not hold a NUL character");

  let timeout = limits.defaultTimeoutMs;
  let clampedFrom: number | null = null;
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new InputError("timeoutMs must be a positive number");
    }
    timeout = Math.ceil(timeoutMs);
    if (timeout > limits.maxTimeoutMs) {
      clampedFrom = timeout;
      timeout = limits.maxTimeoutMs;
    }
  }

  let requestedCwd: string | null = null;
  if (cwd !== undefined) {
    if (typeof cwd !== "string" || cwd.trim() === "" || cwd.includes("\u0000")) {
      throw new InputError("cwd must be a non-blank string without NUL");
    }
    requestedCwd = cwd;
  }
  return {
    request: Object.freeze({ command, timeoutMs: timeout, cwd: requestedCwd }),
    clampedFrom,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
