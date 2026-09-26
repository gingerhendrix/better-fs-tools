/** Bytes per String.fromCharCode call: well under every engine's argument limit. */
const CHUNK = 0x8000;

/** Standard base64 with padding. btoa exists in Node, Bun, browsers, and Workers. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
