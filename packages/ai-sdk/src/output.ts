import type { ContentPart } from "@better-fs-tools/read";

import { toBase64 } from "./base64.ts";

export type AiSdkContentPart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; data: { type: "data"; data: string } };

/** The model output of every AI SDK tool: read, edit, write, apply_patch, and bash. */
export interface AiSdkToolOutput {
  type: "content";
  value: AiSdkContentPart[];
}

/** Converts a read, mutation, or bash result to AI SDK tool output. Media parts become base64 file parts. */
export function toAiSdkOutput(result: {
  readonly content: readonly ContentPart[];
}): AiSdkToolOutput {
  return { type: "content", value: result.content.map(toAiSdkPart) };
}

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
