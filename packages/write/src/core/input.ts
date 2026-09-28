import type { ApplyPatchRequest, EditPair, EditRequest, WriteRequest } from "../contract/input.ts";
import type { WriteLimits } from "../contract/limits.ts";

/**
 * Strict validation of the edit input. Throws TypeError on any key other than
 * path and edits, a bad path, an edit list outside 1 to limits.maxEdits, an
 * empty oldText, a non-string newText, or a non-boolean replaceAll.
 */
export function parseEditInput(input: unknown, limits: Readonly<WriteLimits>): EditRequest {
  const record = inputRecord(input, "edit", ["path", "edits"]);
  const path = validatePath(record.path);
  const { edits } = record;
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new TypeError("edits must be a non-empty array");
  }
  if (edits.length > limits.maxEdits) {
    throw new TypeError(`edits must hold at most ${limits.maxEdits} entries`);
  }
  return { tool: "edit", path, edits: edits.map(parsePair) };
}

/** Strict validation of the write input. The encoded size is checked later, at encode. */
export function parseWriteInput(input: unknown, _limits: Readonly<WriteLimits>): WriteRequest {
  const record = inputRecord(input, "write", ["path", "content"]);
  const path = validatePath(record.path);
  if (typeof record.content !== "string") throw new TypeError("content must be a string");
  return { tool: "write", path, content: record.content };
}

/** Strict validation of the apply_patch input: a non-empty patch within limits.maxPatchBytes. */
export function parseApplyPatchInput(
  input: unknown,
  limits: Readonly<WriteLimits>,
): ApplyPatchRequest {
  const record = inputRecord(input, "apply_patch", ["patch"]);
  const { patch } = record;
  if (typeof patch !== "string" || patch.trim() === "") {
    throw new TypeError("patch must be a non-empty string");
  }
  if (utf8Length(patch, limits.maxPatchBytes) > limits.maxPatchBytes) {
    throw new TypeError(`patch must be at most ${limits.maxPatchBytes} bytes of UTF-8`);
  }
  return { tool: "apply_patch", patch };
}

/**
 * The UTF-8 byte length of `text`. Each UTF-16 unit is at least one byte and
 * at most three, so the count is skipped when the answer is clear either way.
 */
function utf8Length(text: string, max: number): number {
  if (text.length > max) return text.length;
  if (text.length * 3 <= max) return text.length;
  return new TextEncoder().encode(text).byteLength;
}

function inputRecord(
  input: unknown,
  tool: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(input)) throw new TypeError(`The ${tool} input must be an object`);
  for (const key of Object.keys(input)) {
    if (!keys.includes(key)) throw new TypeError(`Unknown ${tool} input key: ${key}`);
  }
  return input;
}

function parsePair(value: unknown, index: number): Required<EditPair> {
  const at = `edits[${index}]`;
  if (!isRecord(value)) throw new TypeError(`${at} must be an object`);
  for (const key of Object.keys(value)) {
    if (key !== "oldText" && key !== "newText" && key !== "replaceAll") {
      throw new TypeError(`Unknown key in ${at}: ${key}`);
    }
  }
  const { oldText, newText, replaceAll } = value;
  if (typeof oldText !== "string" || oldText === "") {
    throw new TypeError(`${at}.oldText must be a non-empty string`);
  }
  if (typeof newText !== "string") throw new TypeError(`${at}.newText must be a string`);
  if (replaceAll !== undefined && typeof replaceAll !== "boolean") {
    throw new TypeError(`${at}.replaceAll must be a boolean`);
  }
  return { oldText, newText, replaceAll: replaceAll ?? false };
}

/** The same path rule as the read tool: a non-blank string without NUL. */
export function isPath(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !value.includes("\0");
}

function validatePath(value: unknown): string {
  if (!isPath(value)) throw new TypeError("path must be a non-empty string without NUL");
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
