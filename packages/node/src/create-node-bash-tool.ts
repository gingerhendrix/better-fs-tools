import path from "node:path";

import { createBashTool, shellEnv } from "@better-fs-tools/shell";
import type { BashTool, BashToolOptions } from "@better-fs-tools/shell";

import { nodeCommandRunner } from "./command-runner.ts";

/**
 * Creates a bash tool that runs commands on the local machine. `runner`
 * defaults to nodeCommandRunner() at process.cwd(). `env` defaults to
 * process.env, read on each call, with defaultShellEnv over it. A relative
 * `cwd` resolves against process.cwd(). There is no authorizer, hook, or
 * spill unless you pass one.
 */
export function createNodeBashTool<THost = undefined>(
  deps: Partial<BashToolOptions<THost>> = {},
): BashTool<THost> {
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
    throw new TypeError("bash tool options must be an object");
  }
  return createBashTool<THost>(withNodeShellDefaults(deps));
}

function withNodeShellDefaults<THost>(
  deps: Partial<BashToolOptions<THost>>,
): BashToolOptions<THost> {
  const given = deps.cwd;
  return {
    ...deps,
    ...(isValidRelativePath(given) ? { cwd: path.resolve(given) } : {}),
    runner: deps.runner ?? nodeCommandRunner(),
    env: deps.env ?? shellEnv(() => process.env),
  };
}

function isValidRelativePath(given: unknown): given is string {
  return (
    typeof given === "string" &&
    given.trim() !== "" &&
    !given.includes("\0") &&
    !path.isAbsolute(given)
  );
}
