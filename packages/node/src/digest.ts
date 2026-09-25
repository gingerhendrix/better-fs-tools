import { createHash } from "node:crypto";

import type { Digest } from "@better-fs-tools/read";

/**
 * SHA-256 over `node:crypto`. The Node read tool uses it by default, because
 * WebCrypto cannot hash incrementally.
 */
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
