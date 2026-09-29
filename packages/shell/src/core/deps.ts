import type { ShellDependencies, ShellToolDeps } from "../contract/deps.ts";
import type { AfterRunHook, BeforeRunHook } from "../contract/extensions.ts";
import type { CommandRunner } from "../contract/runner.ts";
import { defaultShellFormatter } from "../formatters/default.ts";
import { isRecord } from "./input.ts";
import { resolveShellLimits } from "./limits.ts";
import { resolveShellMessages } from "./messages.ts";

const KNOWN: ReadonlySet<string> = new Set([
  "runner",
  "cwd",
  "limits",
  "messages",
  "resolve",
  "authorize",
  "beforeRun",
  "env",
  "spill",
  "afterRun",
  "formatter",
  "digest",
  "clock",
]);

export function resolveShellDependencies<THost>(
  deps: ShellToolDeps<THost>,
): ShellDependencies<THost> {
  if (!isRecord(deps)) throw new TypeError("bash tool dependencies must be an object");
  for (const key of Object.keys(deps)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown bash tool dependency: ${key}`);
  }

  const { runner } = deps;
  if (typeof runner !== "function" && !isRunner(runner)) {
    throw new TypeError("runner must be a command runner or a function that returns one");
  }
  const cwd = deps.cwd ?? null;
  if (cwd !== null && typeof cwd !== "function" && !isAbsolute(cwd)) {
    throw new TypeError("cwd must be an absolute path, a function that returns one, or null");
  }
  const resolve = deps.resolve ?? null;
  if (resolve !== null && (!isRecord(resolve) || typeof resolve.resolve !== "function")) {
    throw new TypeError("resolve must be a path resolver or null");
  }
  const authorize = deps.authorize ?? null;
  if (authorize !== null && (!isRecord(authorize) || typeof authorize.authorize !== "function")) {
    throw new TypeError("authorize must be an authorizer or null");
  }
  const beforeRun = deps.beforeRun ?? [];
  if (!Array.isArray(beforeRun) || !beforeRun.every(isBeforeRunHook)) {
    throw new TypeError("beforeRun must be an array of hooks with an id and beforeRun");
  }
  const { env } = deps;
  if (env === undefined) {
    throw new TypeError(
      "env is required: pass shellEnv(() => process.env), an allow list such as shellEnv({ PATH }), or shellEnv()",
    );
  }
  if (typeof env !== "function") throw new TypeError("env must be a function");
  const spill = deps.spill ?? null;
  if (spill !== null && (!isRecord(spill) || typeof spill.open !== "function")) {
    throw new TypeError("spill must be a spill sink with open, or null");
  }
  const afterRun = deps.afterRun ?? [];
  if (!Array.isArray(afterRun) || !afterRun.every(isAfterRunHook)) {
    throw new TypeError("afterRun must be an array of hooks with an id and afterRun");
  }
  const formatter = deps.formatter ?? defaultShellFormatter();
  if (!isRecord(formatter) || typeof formatter.format !== "function") {
    throw new TypeError("formatter must have a format function");
  }
  const digest = deps.digest ?? null;
  if (
    digest !== null &&
    (!isRecord(digest) || typeof digest.create !== "function" || typeof digest.hash !== "function")
  ) {
    throw new TypeError("digest must be a digest with create and hash, or null");
  }
  const clock = deps.clock ?? (() => new Date());
  if (typeof clock !== "function") throw new TypeError("clock must be a function");

  return Object.freeze<ShellDependencies<THost>>({
    runner,
    cwd,
    limits: resolveShellLimits(deps.limits),
    messages: resolveShellMessages(deps.messages),
    resolve,
    authorize,
    beforeRun: Object.freeze([...beforeRun]),
    env,
    spill,
    afterRun: Object.freeze([...afterRun]),
    formatter,
    digest,
    clock,
  });
}

export function isRunner(value: unknown): value is CommandRunner {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isAbsolute(value.cwd) &&
    typeof value.run === "function"
  );
}

export function isAbsolute(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/");
}

function isBeforeRunHook(value: unknown): value is BeforeRunHook<unknown> {
  return isRecord(value) && typeof value.id === "string" && typeof value.beforeRun === "function";
}

function isAfterRunHook(value: unknown): value is AfterRunHook<unknown> {
  return isRecord(value) && typeof value.id === "string" && typeof value.afterRun === "function";
}
