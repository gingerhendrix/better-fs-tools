import type { ContentPart, ReadResult } from "@better-fs-tools/read";

export type AiSdkContentPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; data: { type: "data"; data: string } };

export interface AiSdkReadOutput {
  type: "content";
  value: AiSdkContentPart[];
}

/** Text parts as text. Media parts as base64 file parts (batch 6). */
export function toAiSdkOutput(result: ReadResult): AiSdkReadOutput {
  return { type: "content", value: result.content.map(toAiSdkPart) };
}

/** One case for each ContentPart type. Batch 6 adds "media". */
function toAiSdkPart(part: ContentPart): AiSdkContentPart {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
  }
}
