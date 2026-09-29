import path from "node:path";

import { createBashTool, shellEnv } from "@better-fs-tools/shell";
import type { BashTool, ShellToolDeps } from "@better-fs-tools/shell";

import { nodeCommandRunner } from "./command-runner.ts";

/**
 * The zero-config local bash tool. `runner` defaults to nodeCommandRunner()
 * at process.cwd(). `env` defaults to process.env, read on each call, with
 * defaultShellEnv over it. A relative `cwd` string resolves against
 * process.cwd(), as nodeCommandRunner({ cwd }) does. Every other dependency keeps the core default:
 * no authorizer, no hooks, no spill.
 */
export function createNodeBashTool<THost = undefined>(
  deps: Partial<ShellToolDeps<THost>> = {},
): BashTool<THost> {
  if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
    throw new TypeError("bash tool dependencies must be an object");
  }
  return createBashTool<THost>(withNodeShellDefaults(deps));
}

export function withNodeShellDefaults<THost>(
  deps: Partial<ShellToolDeps<THost>>,
  cwd?: string,
): ShellToolDeps<THost> {
  const given = deps.cwd;
  // The portable core wants an absolute cwd. Node has a process directory to resolve against.
  const relative =
    typeof given === "string" &&
    given.trim() !== "" &&
    !given.includes("\0") &&
    !path.isAbsolute(given);
  return {
    ...deps,
    ...(relative ? { cwd: path.resolve(given) } : {}),
    runner: deps.runner ?? nodeCommandRunner(cwd === undefined ? {} : { cwd }),
    env: deps.env ?? shellEnv(() => process.env),
  };
}
