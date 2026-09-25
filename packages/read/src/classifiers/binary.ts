import type { Classifier, NoteOverride } from "../contract/classify.ts";
import { classifier, isZip, unsupported } from "./shared.ts";

/** A zip archive, or any NUL byte in the sample. */
export function binaryClassifier(options: { note?: NoteOverride } = {}): Classifier {
  return classifier("binary", (sample) => {
    const action = "a format-specific byte tool";
    if (isZip(sample.bytes)) {
      return unsupported("BINARY", "application/zip", ["zip-magic"], sample, options.note, action);
    }
    if (!sample.bytes.includes(0)) return null;
    return unsupported("BINARY", null, ["nul-byte"], sample, options.note, action);
  });
}
