import type { Digest } from "@better-fs-tools/read";

/** The digest over whole bytes, the way the read tool hashes a whole file. */
export function hashBytes(digest: Digest, bytes: Uint8Array): string {
  const stream = digest.create();
  stream.update(bytes);
  return stream.digest();
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
