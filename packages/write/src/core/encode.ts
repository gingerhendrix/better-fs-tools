import { sameBytes } from "./bytes.ts";
import { extensionId } from "./extension-error.ts";
import type { Planned } from "./planned.ts";
import type { MutationScope } from "./scope.ts";

/**
 * codec.encode on the planned text. Over limits.maxWriteBytes gives
 * TOO_LARGE. Returns "same" when the bytes equal the loaded bytes: the
 * caller decides what that means for its tool.
 */
export function encodePlanned<THost>(
  scope: MutationScope<THost>,
  planned: Planned,
): Uint8Array | "same" {
  scope.enter("encode");
  scope.checkAbort();
  const { limits, messages } = scope.deps;
  const { codec, style, change, loaded, target } = planned;
  const text = change.after?.text ?? "";
  let bytes: unknown;
  try {
    bytes = codec.encode(text, style);
  } catch (error) {
    throw scope.extensionFailure("codecs", extensionId(codec, error));
  }
  if (!(bytes instanceof Uint8Array)) throw scope.extensionFailure("codecs", extensionId(codec));
  if (bytes.byteLength > limits.maxWriteBytes) {
    const limit = limits.maxWriteBytes;
    const path = target.requestedPath;
    throw scope.stop(
      "TOO_LARGE",
      messages.tooLarge({ path, what: "content", limit, existing: loaded !== null }),
      { limit, bytes: bytes.byteLength },
    );
  }
  if (loaded !== null && sameBytes(bytes, loaded.bytes)) return "same";
  return bytes;
}
