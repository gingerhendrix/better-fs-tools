import type { MessageCatalog } from "../contract/messages.ts";
import type { ReadSignature } from "./contract.ts";

/** Retry text in the signature's own names. Merge it under the host's messages. */
export function signatureMessages(signature: ReadSignature): Pick<MessageCatalog, "retry"> {
  if (
    signature === null ||
    typeof signature !== "object" ||
    typeof signature.fromRead !== "function"
  ) {
    throw new TypeError("signatureMessages needs a ReadSignature");
  }
  return Object.freeze({ retry: (next) => JSON.stringify(signature.fromRead(next)) });
}
