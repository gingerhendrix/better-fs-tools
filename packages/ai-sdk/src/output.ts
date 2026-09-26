import type { ContentPart, ReadResult } from "@better-fs-tools/read";

import { toBase64 } from "./base64.ts";

export type AiSdkContentPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; data: { type: "data"; data: string } };

export interface AiSdkReadOutput {
  type: "content";
  value: AiSdkContentPart[];
}

/** Text parts as text. Media parts as base64 file parts. */
export function toAiSdkOutput(result: ReadResult): AiSdkReadOutput {
  return { type: "content", value: result.content.map(toAiSdkPart) };
}

/** One case for each ContentPart type. */
function toAiSdkPart(part: ContentPart): AiSdkContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "media":
      return {
        type: "file",
        mediaType: part.mediaType,
        data: { type: "data", data: toBase64(part.data) },
      };
  }
}
