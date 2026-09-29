import type { ApplyPatchRequest, EditPair, EditRequest, WriteRequest } from "../contract/input.ts";
import type { WriteLimits } from "../contract/limits.ts";

/**
 * Validates edit tool input. Throws TypeError on any key other than path and
 * edits, a bad path, an edit list outside 1 to limits.maxEdits, an empty
 * oldText, a non-string newText, or a non-boolean replaceAll.
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

/**
 * Validates write tool input. Throws TypeError on any key other than path and
 * content, a bad path, or a non-string content.
 */
export function parseWriteInput(input: unknown, _limits: Readonly<WriteLimits>): WriteRequest {
  const record = inputRecord(input, "write", ["path", "content"]);
  const path = validatePath(record.path);
  if (typeof record.content !== "string") throw new TypeError("content must be a string");
  return { tool: "write", path, content: record.content };
}

/**
 * Validates apply_patch tool input. Throws TypeError unless it holds only a
 * non-empty patch of at most limits.maxPatchBytes UTF-8 bytes.
 */
export function parseApplyPatchInput(
  input: unknown,
  limits: Readonly<WriteLimits>,
): ApplyPatchRequest {
  const record = inputRecord(input, "apply_patch", ["patch"]);
  const { patch } = record;
  if (typeof patch !== "string" || patch.trim() === "") {
    throw new TypeError("patch must be a non-empty string");
  }
  if (utf8LengthComparedTo(patch, limits.maxPatchBytes) > limits.maxPatchBytes) {
    throw new TypeError(`patch must be at most ${limits.maxPatchBytes} bytes of UTF-8`);
  }
  return { tool: "apply_patch", patch };
}

function utf8LengthComparedTo(text: string, max: number): number {
  // Each UTF-16 code unit encodes to between 1 and 3 UTF-8 bytes.
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
