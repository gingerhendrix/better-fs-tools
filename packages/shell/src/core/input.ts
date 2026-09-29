import type { BashRequest } from "../contract/input.ts";
import type { ShellLimits } from "../contract/limits.ts";

const KEYS: ReadonlySet<string> = new Set(["command", "timeoutMs", "cwd"]);

/**
 * Checks canonical input and fills defaults. Throws TypeError on bad input.
 * `command` must hold a non-whitespace character and no NUL.
 * `timeoutMs` must be a positive finite number. It is rounded up to a whole
 * millisecond and clamped to maxTimeoutMs; the tool adds a clamped note.
 * `cwd` must be a non-blank string without NUL.
 */
export function parseBashInput(input: unknown, limits: Readonly<ShellLimits>): BashRequest {
  if (!isRecord(input)) throw new TypeError("the input must be an object with a command");
  for (const key of Object.keys(input)) {
    if (!KEYS.has(key)) throw new TypeError(`unknown key ${key}. Expected command, timeoutMs, cwd`);
  }
  const { command, timeoutMs, cwd } = input;
  if (typeof command !== "string" || command.trim() === "") {
    throw new TypeError("command must be a non-blank string");
  }
  if (command.includes("\u0000")) throw new TypeError("command must not hold a NUL character");

  let timeout = limits.defaultTimeoutMs;
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be a positive number");
    }
    timeout = Math.min(Math.ceil(timeoutMs), limits.maxTimeoutMs);
  }

  let requestedCwd: string | null = null;
  if (cwd !== undefined) {
    if (typeof cwd !== "string" || cwd.trim() === "" || cwd.includes("\u0000")) {
      throw new TypeError("cwd must be a non-blank string without NUL");
    }
    requestedCwd = cwd;
  }
  return Object.freeze({ command, timeoutMs: timeout, cwd: requestedCwd });
}

export function clampedTimeout(input: unknown, request: BashRequest): number | null {
  if (!isRecord(input) || typeof input.timeoutMs !== "number") return null;
  const requested = Math.ceil(input.timeoutMs);
  return requested > request.timeoutMs ? requested : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
