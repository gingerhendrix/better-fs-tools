import type { Classifier, NoteOverride } from "../contract/classify.ts";
import { classifier, isZip, unsupported } from "./shared.ts";

/** Refuses zip archives and samples that contain a NUL byte. */
export function binaryClassifier(options: { note?: NoteOverride } = {}): Classifier {
  return classifier("binary", (sample) => {
    const suggestedTool = "a format-specific byte tool";
    if (isZip(sample.bytes)) {
      return unsupported(
        "BINARY",
        "application/zip",
        ["zip-magic"],
        sample,
        options.note,
        suggestedTool,
      );
    }
    if (!sample.bytes.includes(0)) return null;
    return unsupported("BINARY", null, ["nul-byte"], sample, options.note, suggestedTool);
  });
}
