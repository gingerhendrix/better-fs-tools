import { Buffer } from "node:buffer";

import type { ContentPart } from "@better-fs-tools/read";

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
      return {
        type: "image",
        data: Buffer.from(part.data.buffer, part.data.byteOffset, part.data.byteLength).toString(
          "base64",
        ),
        mimeType: part.mediaType,
      };
  }
}
