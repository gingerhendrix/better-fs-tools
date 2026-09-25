import type { Classifier, NoteOverride } from "../contract/classify.ts";
import { classifier, startsWithAscii, unsupported } from "./shared.ts";

export function pdfClassifier(options: { note?: NoteOverride } = {}): Classifier {
  return classifier("pdf", (sample) => {
    if (!startsWithAscii(sample.bytes, "%PDF-")) return null;
    return unsupported(
      "PDF",
      "application/pdf",
      ["pdf-magic"],
      sample,
      options.note,
      "a PDF extraction tool",
    );
  });
}
