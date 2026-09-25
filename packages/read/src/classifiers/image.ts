import type { Classifier, NoteOverride } from "../contract/classify.ts";
import { asciiProjection, classifier, startsWith, startsWithAscii, unsupported } from "./shared.ts";

/** PNG, JPEG, GIF, and WebP magic bytes. */
export function imageClassifier(options: { note?: NoteOverride } = {}): Classifier {
  return classifier("image", (sample) => {
    const mimeType = imageSignature(sample.bytes);
    if (mimeType === null) return null;
    return unsupported(
      "IMAGE",
      mimeType,
      ["image-magic"],
      sample,
      options.note,
      "an image or vision tool",
    );
  });
}

function imageSignature(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a")) return "image/gif";
  if (startsWithAscii(bytes, "RIFF") && asciiProjection(bytes.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}
