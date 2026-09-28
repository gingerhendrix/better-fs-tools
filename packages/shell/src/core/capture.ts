import type { ShellLimits } from "../contract/limits.ts";
import type { ShellOutput } from "../contract/result.ts";
import type { OutputChunk } from "../contract/runner.ts";

const NEWLINE = 0x0a;

/**
 * Holds the merged output in bounded memory: the first `maxOutputBytes`
 * bytes, the last `maxOutputBytes` bytes, and counts. The middle is dropped
 * as it arrives. Memory stays near two view budgets, whatever the command
 * writes.
 */
export class OutputCapture {
  readonly #cap: number;
  readonly #head: Uint8Array;
  #headLength = 0;
  #tail: Uint8Array[] = [];
  #tailLength = 0;
  #total = 0;
  #newlines = 0;
  #lastByte = -1;
  #stdout = 0;
  #stderr = 0;

  constructor(limits: Readonly<ShellLimits>) {
    this.#cap = limits.maxOutputBytes;
    this.#head = new Uint8Array(this.#cap);
  }

  get totalBytes(): number {
    return this.#total;
  }

  push(chunk: OutputChunk): void {
    const { bytes } = chunk;
    if (bytes.byteLength === 0) return;
    this.#total += bytes.byteLength;
    if (chunk.stream === "stderr") this.#stderr += bytes.byteLength;
    else this.#stdout += bytes.byteLength;
    for (const byte of bytes) if (byte === NEWLINE) this.#newlines += 1;
    this.#lastByte = bytes[bytes.byteLength - 1] ?? this.#lastByte;

    if (this.#headLength < this.#cap) {
      const take = Math.min(this.#cap - this.#headLength, bytes.byteLength);
      this.#head.set(bytes.subarray(0, take), this.#headLength);
      this.#headLength += take;
    }
    // Copy: the runner may reuse its buffer.
    const kept = bytes.byteLength > this.#cap ? bytes.slice(-this.#cap) : bytes.slice();
    this.#tail.push(kept);
    this.#tailLength += kept.byteLength;
    while (
      this.#tail.length > 1 &&
      this.#tailLength - (this.#tail[0]?.byteLength ?? 0) >= this.#cap
    ) {
      this.#tailLength -= this.#tail.shift()?.byteLength ?? 0;
    }
  }

  /** The bounded view. `spill` is the spill sink's reference, or null. */
  view(limits: Readonly<ShellLimits>, spill: string | null): ShellOutput {
    const total = this.#total;
    const totalLines = this.#newlines + (total > 0 && this.#lastByte !== NEWLINE ? 1 : 0);
    const counts = {
      totalBytes: total,
      totalLines,
      stdoutBytes: this.#stdout,
      stderrBytes: this.#stderr,
      spill,
    };
    const head = this.#head.subarray(0, this.#headLength);
    if (total <= limits.maxOutputBytes && totalLines <= limits.maxOutputLines) {
      return { ...counts, head: text(head), tail: null, omittedBytes: 0, omittedLines: 0 };
    }

    const headBytes = Math.floor((limits.maxOutputBytes * limits.headPercent) / 100);
    const headLines = Math.floor((limits.maxOutputLines * limits.headPercent) / 100);
    const headEnd = headCut(head, headBytes, headLines);

    const tailStore = concat(this.#tail, this.#tailLength);
    const storeStart = total - tailStore.byteLength;
    const tailBytes = limits.maxOutputBytes - headBytes;
    const tailLines = limits.maxOutputLines - headLines;
    const from = Math.max(total - tailBytes, headEnd);
    // Is the byte before `from` a newline, or is `from` the start of the output?
    const before = from - 1;
    const startsLine =
      from === 0 ||
      (before >= storeStart
        ? tailStore[before - storeStart] === NEWLINE
        : before < this.#headLength && head[before] === NEWLINE);
    const tailStart = tailCut(tailStore, from - storeStart, tailLines, startsLine);
    const shownTail = tailStore.subarray(tailStart);

    const shownHead = head.subarray(0, headEnd);
    const omittedBytes = total - shownHead.byteLength - shownTail.byteLength;
    const omittedLines = Math.max(0, totalLines - lineCount(shownHead) - lineCount(shownTail));
    return {
      ...counts,
      head: text(shownHead),
      tail: text(shownTail),
      omittedBytes,
      omittedLines,
    };
  }
}

/**
 * End of the head: at most `bytes` bytes and `lines` lines, cut after a
 * newline when the budget holds one, else at a UTF-8 character boundary.
 */
function headCut(head: Uint8Array, bytes: number, lines: number): number {
  // A zero line budget shows no head, not the first line.
  if (lines <= 0) return 0;
  const limit = Math.min(bytes, head.byteLength);
  let seen = 0;
  let lastNewline = -1;
  for (let index = 0; index < limit; index += 1) {
    if (head[index] !== NEWLINE) continue;
    seen += 1;
    lastNewline = index;
    if (seen >= lines) break;
  }
  if (lastNewline >= 0) return lastNewline + 1;
  return charBoundaryBack(head, limit);
}

/**
 * Start of the tail in `store`: from `from`, moved forward to a line start
 * unless it already is one, then forward again until at most `lines` lines remain.
 */
function tailCut(store: Uint8Array, from: number, lines: number, startsLine: boolean): number {
  let start = from;
  if (!startsLine) {
    const next = store.indexOf(NEWLINE, start);
    if (next >= 0 && next < store.byteLength - 1) start = next + 1;
    else start = charBoundaryForward(store, start);
  }
  // Keep the last `lines` lines. A final newline ends the last line; it does not start one.
  const end = store[store.byteLength - 1] === NEWLINE ? store.byteLength - 1 : store.byteLength;
  let seen = 0;
  for (let index = end - 1; index >= start; index -= 1) {
    if (store[index] !== NEWLINE) continue;
    seen += 1;
    if (seen >= lines) return index + 1;
  }
  return lines === 0 ? store.byteLength : start;
}

function charBoundaryBack(bytes: Uint8Array, end: number): number {
  let cut = end;
  while (cut > 0 && cut < bytes.byteLength && isContinuation(bytes[cut])) cut -= 1;
  return cut;
}

function charBoundaryForward(bytes: Uint8Array, start: number): number {
  let cut = start;
  while (cut < bytes.byteLength && isContinuation(bytes[cut])) cut += 1;
  return cut;
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

function lineCount(bytes: Uint8Array): number {
  if (bytes.byteLength === 0) return 0;
  let count = 0;
  for (const byte of bytes) if (byte === NEWLINE) count += 1;
  return bytes[bytes.byteLength - 1] === NEWLINE ? count : count + 1;
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// Control sequences (CSI), operating system commands (OSC), and two-byte escapes.
const ANSI = new RegExp(
  [
    "\\u001b\\[[0-?]*[ -/]*[@-~]",
    "\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)",
    "\\u001b[@-Z\\\\-_]",
    "\\u009b[0-?]*[ -/]*[@-~]",
  ].join("|"),
  "gu",
);

/** UTF-8 with replacement characters, ANSI codes removed, one final newline dropped. */
function text(bytes: Uint8Array): string {
  const decoded = new TextDecoder("utf-8").decode(bytes).replace(ANSI, "");
  return decoded.endsWith("\n") ? decoded.slice(0, -1) : decoded;
}
