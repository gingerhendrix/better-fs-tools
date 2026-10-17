import type { Context } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

import type { ToolCallContext } from "@better-fs-tools/read";
import type { CommandRunner } from "@better-fs-tools/shell";

import { executionEnvFileSystem } from "./filesystem.ts";
import type { ExecutionEnvFileSystem, ExecutionEnvFileSystemOptions } from "./filesystem.ts";
import { executionEnvRunner } from "./runner.ts";
import type { ExecutionEnvRunnerOptions } from "./runner.ts";

/** The host of each call. Host functions, such as an authorizer, get it as ctx.call.host. */
export interface DurableFsHost {
  readonly api: ToolExecutionApi;
  readonly env: ExecutionEnv;
  readonly context: Context;
}

/** A factory of the call, as the `fs`, `state`, and `runner` options of a tool take. */
export type DurableCallFactory<T> = (call: ToolCallContext<DurableFsHost>) => T;

/**
 * The options of executionEnvFileSystem() without `context`, which comes from
 * the call. `allowedRoots` is optional here.
 */
export type DurableEnvFileSystemOptions = Omit<
  ExecutionEnvFileSystemOptions,
  "context" | "allowedRoots"
> & {
  /** Relative to the environment's cwd. Default ["."]: only the working directory of the call. */
  readonly allowedRoots?: readonly string[];
};

/** The options of executionEnvRunner() without `context`, which comes from the call. */
export type DurableEnvRunnerOptions = Omit<ExecutionEnvRunnerOptions, "context">;

/**
 * A per-call filesystem: executionEnvFileSystem() over the call's environment
 * and Chord context. Pass it as `fs` to createDurableFsTools().
 */
export function durableEnvFileSystem(
  options: DurableEnvFileSystemOptions = {},
): DurableCallFactory<ExecutionEnvFileSystem> {
  checkOptions(options, "durableEnvFileSystem");
  const { allowedRoots = ["."], ...rest } = options;
  return (call) =>
    executionEnvFileSystem(call.host.env, {
      ...rest,
      allowedRoots,
      context: call.host.context,
    });
}

/**
 * A per-call runner: executionEnvRunner() over the call's environment and
 * Chord context. Pass it as the bash `runner` of createDurableFsTools().
 */
export function durableEnvRunner(
  options: DurableEnvRunnerOptions = {},
): DurableCallFactory<CommandRunner> {
  checkOptions(options, "durableEnvRunner");
  return (call) => executionEnvRunner(call.host.env, { ...options, context: call.host.context });
}

function checkOptions(options: unknown, label: string): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`${label} options must be an object`);
  }
  if (Object.hasOwn(options, "context")) {
    throw new TypeError(`${label} options cannot set context: it comes from the call`);
  }
}
