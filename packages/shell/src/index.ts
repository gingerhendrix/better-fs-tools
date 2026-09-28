export type { BashInput, BashRequest } from "./contract/input.ts";
export type { BashTool } from "./contract/context.ts";
export type {
  CommandRunner,
  OutputChunk,
  RunExit,
  RunHandle,
  RunRequest,
  RunStartError,
} from "./contract/runner.ts";
export type {
  ShellError,
  ShellErrorCode,
  ShellOutput,
  ShellPhase,
  ShellReport,
  ShellResult,
  ShellRun,
  ShellStatus,
} from "./contract/result.ts";
export type { ShellDependencies, ShellToolDeps } from "./contract/deps.ts";
export type {
  AfterRunHook,
  BeforeRunDecision,
  BeforeRunHook,
  PlannedRun,
  RunOutcome,
  ShellAuthorizer,
  ShellAuthorizeTarget,
  ShellEnv,
  ShellHookContext,
  SpillSink,
  SpillWriter,
} from "./contract/extensions.ts";
export type { ShellFormatContext, ShellFormatter } from "./contract/format.ts";
export type { ShellLimits } from "./contract/limits.ts";
export type { ShellCanonicalParam, ShellMessageCatalog } from "./contract/messages.ts";

export { createBashTool } from "./core/create-bash-tool.ts";
export { parseBashInput } from "./core/input.ts";
export { defaultShellLimits, resolveShellLimits } from "./core/limits.ts";
export {
  defaultShellMessages,
  formatBytes,
  formatDuration,
  resolveShellMessages,
} from "./core/messages.ts";
export { defaultShellEnv, shellEnv } from "./core/env.ts";
export { defaultShellFormatter } from "./formatters/index.ts";
export type { ShellFormatterOptions } from "./formatters/index.ts";
export { textOf } from "@better-fs-tools/read";
