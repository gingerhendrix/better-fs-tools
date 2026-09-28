import type { PathResolver, ToolCallContext } from "@better-fs-tools/read";

import type {
  AfterRunHook,
  BeforeRunHook,
  ShellAuthorizer,
  ShellEnv,
  SpillSink,
} from "./extensions.ts";
import type { ShellFormatter } from "./format.ts";
import type { ShellLimits } from "./limits.ts";
import type { ShellMessageCatalog } from "./messages.ts";
import type { CommandRunner } from "./runner.ts";

export interface ShellDependencies<THost = undefined> {
  /** A runner, or a factory called once for each call. */
  readonly runner: CommandRunner | ((call: ToolCallContext<THost>) => CommandRunner);
  /** The default cwd, or a factory. Default the runner's cwd. */
  readonly cwd: string | ((call: ToolCallContext<THost>) => string) | null;
  readonly limits: Readonly<ShellLimits>;
  readonly messages: Readonly<ShellMessageCatalog>;
  /** Changes the requested cwd string, as for the read tool. null is identity. */
  readonly resolve: PathResolver<THost> | null;
  /** Host policy. null allows. */
  readonly authorize: ShellAuthorizer<THost> | null;
  readonly beforeRun: readonly BeforeRunHook<THost>[];
  /** Default: defaultShellEnv only. The Node factories add process.env. */
  readonly env: ShellEnv<THost>;
  /** null turns spill off. */
  readonly spill: SpillSink<THost> | null;
  readonly afterRun: readonly AfterRunHook<THost>[];
  readonly formatter: ShellFormatter<THost>;
}

/**
 * Only `runner` is required. `limits` and `messages` merge key by key. Every
 * other dependency replaces its default.
 */
export type ShellToolDeps<THost = undefined> = {
  readonly runner: ShellDependencies<THost>["runner"];
  readonly limits?: Partial<ShellLimits>;
  readonly messages?: Partial<ShellMessageCatalog>;
} & Partial<Omit<ShellDependencies<THost>, "runner" | "limits" | "messages">>;
