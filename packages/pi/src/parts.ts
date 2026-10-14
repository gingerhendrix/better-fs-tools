import type { ContentPart } from "@better-fs-tools/read";

// Keeps each String.fromCharCode spread under engine argument-count limits.
const CHUNK = 0x8000;

export type PiContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function toPiPart(part: ContentPart, tool: string): PiContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "media":
      // Pi's tool content takes images only.
      if (!part.mediaType.startsWith("image/")) {
        return {
          type: "text",
          text: `[${tool}:media-omitted] ${part.mediaType} (${part.data.byteLength} bytes) cannot be shown in Pi.`,
        };
      }
      return { type: "image", data: toBase64(part.data), mimeType: part.mediaType };
  }
}

/** Base64 without node:buffer, so the agent core tools run in a browser or a Worker. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
