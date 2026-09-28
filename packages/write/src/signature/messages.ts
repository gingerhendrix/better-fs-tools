import type { WriteMessageCatalog } from "../contract/messages.ts";
import type { MutationSignature } from "./contract.ts";

/** messages.param from the signature. Merge it under the host's messages. */
export function writeSignatureMessages(
  signature: MutationSignature<unknown>,
): Pick<WriteMessageCatalog, "param"> {
  if (
    signature === null ||
    typeof signature !== "object" ||
    typeof signature.param !== "function"
  ) {
    throw new TypeError("writeSignatureMessages needs a MutationSignature");
  }
  return Object.freeze({ param: (name) => signature.param(name) });
}
