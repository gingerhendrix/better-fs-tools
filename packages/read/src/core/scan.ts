import type { ClassificationSample } from "../contract/classify.ts";
import type { Digest } from "../contract/digest.ts";
import type { ReadRequest } from "../contract/input.ts";
import type { ReadLimits } from "../contract/limits.ts";
import { scanBudget } from "./budget.ts";
import type { CallScope } from "./call-scope.ts";
import type { ByteCursor } from "./cursor.ts";
import { LineScanner } from "./scanner.ts";

const ABORT_YIELD_BYTES = 1024 * 1024;

/** `TextDecoder` is a global value rather than a type in every runtime lib. */
type Utf8Decoder = InstanceType<typeof TextDecoder>;

class DecoderFailureError extends Error {}

export type ScanOutcome =
  | {
      readonly kind: "scanned";
      readonly scanner: LineScanner;
      readonly scannedBytes: number;
      readonly scanCapped: boolean;
      readonly reachedEof: boolean;
      /** Hash of every source byte. null without a digest or when the scan stopped before EOF. */
      readonly contentId: string | null;
    }
  | { readonly kind: "invalid-utf8" };

export interface ScanInput<THost> {
  readonly cursor: ByteCursor;
  readonly sample: ClassificationSample;
  readonly request: ReadRequest;
  readonly limits: Readonly<ReadLimits>;
  readonly digest: Digest | null;
  readonly scope: CallScope<THost>;
}

/**
 * Decodes and scans the sample, then the rest of the stream, up to
 * `limits.maxScanBytes`. The view budget, when set, applies to every scan. The scanner keeps only the view and counters, so a
 * large file stays flat in memory. The scan keeps counting after the view
 * closes, so totals and the content hash are exact when the scan reaches EOF.
 */
export async function scanText<THost>(input: ScanInput<THost>): Promise<ScanOutcome> {
  const { cursor, sample, request, limits, digest, scope } = input;
  const scanner = new LineScanner(request, limits, scanBudget(scope));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const contentHash = digest === null ? null : digest.create();
  let scannedBytes = 0;
  let scanCapped = false;
  let unscannedBytesKnown = false;
  let reachedEof = sample.complete;
  let nextAbortYield = ABORT_YIELD_BYTES;

  const consume = (chunk: Uint8Array): void => {
    const available = limits.maxScanBytes - scannedBytes;
    if (available <= 0) {
      scanCapped = chunk.byteLength > 0;
      unscannedBytesKnown ||= chunk.byteLength > 0;
      return;
    }
    const accepted = chunk.subarray(0, available);
    if (accepted.byteLength > 0) {
      contentHash?.update(accepted);
      scannedBytes += accepted.byteLength;
      scanner.push(decodeChunk(decoder, accepted));
    }
    if (accepted.byteLength < chunk.byteLength) {
      scanCapped = true;
      unscannedBytesKnown = true;
    }
  };

  try {
    consume(sample.bytes);
    while (!scanCapped && !reachedEof) {
      scope.checkAbort();
      if (scope.signal !== undefined && scannedBytes >= nextAbortYield) {
        await yieldForAbort();
        nextAbortYield = scannedBytes + ABORT_YIELD_BYTES;
        scope.checkAbort();
      }
      const item = await cursor.next(scope.signal);
      if (item.done) {
        reachedEof = true;
        break;
      }
      consume(item.value);
    }
    scope.checkAbort();
    if (reachedEof) {
      const trailing = finishDecoder(decoder);
      if (trailing) scanner.push(trailing);
      scanner.finish();
    } else {
      scanner.cap(unscannedBytesKnown);
    }
  } catch (error) {
    if (error instanceof DecoderFailureError) return { kind: "invalid-utf8" };
    throw error;
  }

  return {
    kind: "scanned",
    scanner,
    scannedBytes,
    scanCapped,
    reachedEof,
    contentId: reachedEof ? (contentHash?.digest() ?? null) : null,
  };
}

function decodeChunk(decoder: Utf8Decoder, chunk: Uint8Array): string {
  try {
    return decoder.decode(chunk, { stream: true });
  } catch (error) {
    throw new DecoderFailureError("Invalid UTF-8", { cause: error });
  }
}

function finishDecoder(decoder: Utf8Decoder): string {
  try {
    return decoder.decode();
  } catch (error) {
    throw new DecoderFailureError("Invalid UTF-8", { cause: error });
  }
}

function yieldForAbort(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
