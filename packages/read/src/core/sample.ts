import type { ClassificationSample } from "../contract/classify.ts";
import type { ReadLimits } from "../contract/limits.ts";
import type { FileInfo } from "../contract/result.ts";
import type { CallScope } from "./call-scope.ts";
import type { ByteCursor } from "./cursor.ts";

/**
 * Reads at most `limits.sampleBytes` from the cursor. Bytes past the sample go
 * back to the cursor, so the scan sees every byte once.
 */
export async function takeSample<THost>(
  cursor: ByteCursor,
  limits: Readonly<ReadLimits>,
  file: FileInfo,
  scope: CallScope<THost>,
): Promise<ClassificationSample> {
  const buffer = new Uint8Array(limits.sampleBytes);
  let length = 0;
  let reachedEof = false;

  while (length < limits.sampleBytes) {
    scope.checkAbort();
    const item = await cursor.next(scope.signal);
    if (item.done) {
      reachedEof = true;
      break;
    }
    const accepted = Math.min(limits.sampleBytes - length, item.value.byteLength);
    buffer.set(item.value.subarray(0, accepted), length);
    length += accepted;
    if (accepted < item.value.byteLength) cursor.unshift(item.value.subarray(accepted));
  }

  return {
    bytes: buffer.subarray(0, length),
    complete: reachedEof,
    path: file.displayPath,
    mimeType: file.mimeType,
  };
}
