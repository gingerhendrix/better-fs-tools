/** The `./patch` subpath: the Codex patch parser, its Lark grammar, and the patch types. */
export { CODEX_PATCH_GRAMMAR } from "./grammar.ts";
export { codexPatchParser, parsePatch } from "./parse.ts";
export type {
  PatchHunk,
  PatchLine,
  PatchOperation,
  PatchParseOutcome,
  PatchParser,
  PatchPlan,
} from "../contract/patch.ts";
