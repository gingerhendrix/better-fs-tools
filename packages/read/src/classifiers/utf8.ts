import type {
  Classification,
  ClassificationSample,
  Classifier,
  NoteOverride,
  UnsupportedClassification,
} from "../contract/classify.ts";
import type { ReadNote } from "../contract/result.ts";
import { startsWith, unsupported } from "./shared.ts";

/**
 * Decodes the sample as UTF-8. This is the only built-in that returns text. It
 * also owns the UNKNOWN_ENCODING refusal for invalid bytes that the scan finds
 * after the sample looked clean.
 */
export function utf8Classifier(options: { note?: NoteOverride } = {}): Classifier {
  const refuse = (sample: ClassificationSample): UnsupportedClassification =>
    unsupported(
      "UNKNOWN_ENCODING",
      null,
      ["invalid-utf8"],
      sample,
      options.note,
      "a byte or encoding-aware tool",
    );

  const classify = (sample: ClassificationSample): Classification | null => {
    const decoded = decodeStrict(sample.bytes);
    if (decoded.kind === "invalid" || (decoded.kind === "incomplete" && sample.complete)) {
      return refuse(sample);
    }
    const text = decoded.text.replace(/^﻿/u, "");
    const reasons = ["utf8"];
    const hasBom = startsWith(sample.bytes, [0xef, 0xbb, 0xbf]);
    if (hasBom) reasons.push("utf8-bom");
    if (decoded.kind === "incomplete") reasons.push("incomplete-sample-suffix");
    const svg = looksLikeSvg(text);
    if (svg) reasons.push("svg-text");
    const notes: ReadNote[] = hasBom
      ? [
          {
            code: "utf8-bom",
            severity: "info",
            message: "The file begins with a UTF-8 byte order mark, which is included in line 1.",
          },
        ]
      : [];
    return {
      kind: "text",
      mimeType: svg ? "image/svg+xml" : (sample.mimeType ?? "text/plain"),
      confidence: decoded.kind === "incomplete" ? "medium" : "high",
      reasons,
      ...(notes.length > 0 ? { notes } : {}),
    };
  };

  return Object.freeze({ id: "utf8", classify, encodingFailure: refuse });
}

type DecodeResult =
  | { kind: "complete"; text: string }
  | { kind: "incomplete"; text: string }
  | { kind: "invalid"; text: "" };

function decodeStrict(bytes: Uint8Array): DecodeResult {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text: string;
  try {
    text = decoder.decode(bytes, { stream: true });
  } catch {
    return { kind: "invalid", text: "" };
  }
  try {
    decoder.decode();
  } catch {
    return { kind: "incomplete", text };
  }
  return { kind: "complete", text };
}

function looksLikeSvg(text: string): boolean {
  return /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg(?:\s|>)/iu.test(text.slice(0, 4_096));
}
