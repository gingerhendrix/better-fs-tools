export type {
  ApplyPatchInput,
  ApplyPatchRequest,
  EditInput,
  EditPair,
  EditRequest,
  MutationRequest,
  WriteInput,
  WriteRequest,
} from "./contract/input.ts";
export type {
  ApplyPatchTool,
  EditTool,
  MutationTool,
  WriteTool,
  WriteToolName,
} from "./contract/context.ts";
export type {
  CommitFileState,
  CommitReport,
  FileChange,
  FileVersion,
  MatchInfo,
  MutationReport,
  MutationResult,
  Snippet,
  WriteError,
  WriteErrorCode,
  WritePhase,
} from "./contract/result.ts";
export type {
  EditDependencies,
  EditToolDeps,
  WriteDependencies,
  WriteToolDeps,
} from "./contract/deps.ts";
export type {
  AfterWriteContext,
  ChangeFragment,
  Guard,
  GuardContext,
  GuardDecision,
  PlannedChange,
  PlannedText,
  WriteAuthorizeDecision,
  WriteAuthorizer,
  WriteAuthorizeTarget,
  WriteHook,
  WriteHookContext,
  WriteHookResult,
} from "./contract/extensions.ts";
export type { Codec, DecodeOutcome, TextStyle } from "./contract/codec.ts";
export type { Matcher, MatchContext, MatchRange } from "./contract/matcher.ts";
export type { LockManager, LockOutcome } from "./contract/locks.ts";
export type { PreconditionPolicy } from "./contract/preconditions.ts";
export type { WriteFormatContext, WriteFormatter } from "./contract/format.ts";
export type { WriteLimits } from "./contract/limits.ts";
export type { CanonicalParam, WriteMessageCatalog } from "./contract/messages.ts";

export { createEditTool, createWriteTool } from "./core/create-tools.ts";
export { parseApplyPatchInput, parseEditInput, parseWriteInput } from "./core/input.ts";
export { defaultWriteLimits, resolveWriteLimits } from "./core/limits.ts";
export { defaultWriteMessages, resolveWriteMessages } from "./core/messages.ts";
export { defaultPreconditions } from "./contract/preconditions.ts";
export {
  blockAnchorMatcher,
  defaultEditMatchers,
  defaultPatchMatchers,
  escapeMatcher,
  exactMatcher,
  indentationMatcher,
  lineTrimmedMatcher,
  normalizedMatcher,
} from "./matchers/index.ts";
export { utf8Codec } from "./codecs/index.ts";
export { memoryLocks } from "./locks/index.ts";
export { askBeforeWrite, writeAuthorizers } from "./authorize/index.ts";
export { defaultWriteFormatter } from "./formatters/index.ts";
export type { WriteFormatterOptions } from "./formatters/index.ts";
export { createInvalidator } from "./state/index.ts";
export { textOf } from "@better-fs-tools/read";
