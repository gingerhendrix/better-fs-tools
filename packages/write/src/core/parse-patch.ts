import type { PatchHunk, PatchOperation, PatchParser } from "../contract/patch.ts";
import { extensionId } from "./extension-error.ts";
import { isPath, isRecord } from "./input.ts";
import type { MutationScope } from "./scope.ts";

export function parsePatchText<THost>(
  scope: MutationScope<THost>,
  parser: PatchParser,
  text: string,
): readonly PatchOperation[] {
  scope.enter("input");
  const { messages, limits } = scope.deps;
  let outcome: unknown;
  try {
    outcome = parser.parse(text);
  } catch (error) {
    throw scope.extensionFailure("patchParser", extensionId(parser, error));
  }
  const malformed = () => scope.extensionFailure("patchParser", extensionId(parser));
  if (!isRecord(outcome)) throw malformed();
  if (outcome.ok === false) {
    const { error } = outcome;
    if (!isRecord(error) || !isLine(error.line) || typeof error.detail !== "string") {
      throw malformed();
    }
    const { line, detail } = error;
    throw scope.stop("PATCH_PARSE", messages.patchParse({ line, detail }), { line, detail });
  }
  if (outcome.ok !== true || !isRecord(outcome.plan)) throw malformed();
  const { operations } = outcome.plan;
  if (!Array.isArray(operations) || operations.length === 0 || !operations.every(isOperation)) {
    throw malformed();
  }
  if (operations.length > limits.maxPatchFiles) {
    const limit = limits.maxPatchFiles;
    throw scope.stop(
      "TOO_LARGE",
      messages.tooLarge({ path: null, what: "patch", limit, existing: false }),
      { limit, operations: operations.length },
    );
  }
  return operations;
}

function isOperation(value: unknown): value is PatchOperation {
  if (!isRecord(value) || !isPath(value.path) || !isLine(value.line)) return false;
  if (value.kind === "add") return typeof value.content === "string";
  if (value.kind === "delete") return true;
  if (value.kind !== "update") return false;
  const { moveTo, hunks } = value;
  if (moveTo !== null && !isPath(moveTo)) return false;
  return Array.isArray(hunks) && hunks.every(isHunk);
}

function isHunk(value: unknown): value is PatchHunk {
  if (!isRecord(value) || !isLine(value.line) || typeof value.endOfFile !== "boolean") return false;
  if (value.context !== null && typeof value.context !== "string") return false;
  const { lines } = value;
  return (
    Array.isArray(lines) &&
    lines.every(
      (line) =>
        isRecord(line) &&
        (line.kind === " " || line.kind === "-" || line.kind === "+") &&
        typeof line.text === "string" &&
        !line.text.includes("\n"),
    )
  );
}

function isLine(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}
