import { createHash } from "node:crypto";

import type { Digest } from "@better-fs-tools/read";

/** A SHA-256 digest using `node:crypto`. The default digest of the Node tools. */
export function nodeDigest(): Digest {
  return Object.freeze({
    id: "sha256",
    create() {
      const hash = createHash("sha256");
      return {
        update(bytes: Uint8Array) {
          hash.update(bytes);
        },
        digest() {
          return `sha256:${hash.digest("hex")}`;
        },
      };
    },
    hash(value: string) {
      return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
    },
  });
}
