import type { ReadMessageCatalog } from "../contract/messages.ts";
import type { ReadSignature } from "./contract.ts";

/** Retry text in the signature's own names. Merge it under the host's messages. */
export function readSignatureMessages(signature: ReadSignature): Pick<ReadMessageCatalog, "retry"> {
  if (
    signature === null ||
    typeof signature !== "object" ||
    typeof signature.fromInput !== "function"
  ) {
    throw new TypeError("readSignatureMessages needs a ReadSignature");
  }
  return Object.freeze({ retry: (next) => JSON.stringify(signature.fromInput(next)) });
}
