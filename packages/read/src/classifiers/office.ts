import type { Classifier, NoteOverride } from "../contract/classify.ts";
import { asciiProjection, classifier, isZip, unsupported } from "./shared.ts";

/** A zip with an Office marker in the sample or an Office extension. */
export function officeClassifier(options: { note?: NoteOverride } = {}): Classifier {
  return classifier("office", (sample) => {
    if (!isZip(sample.bytes)) return null;
    const path = sample.path.toLowerCase();
    const marker = /\[Content_Types\]\.xml|word\/|xl\/|ppt\//u.test(asciiProjection(sample.bytes));
    const extension = /\.(docx|xlsx|pptx)$/u.test(path);
    if (!marker && !extension) return null;
    const reasons = [
      ...(marker ? ["office-zip-marker"] : []),
      ...(extension ? ["office-extension"] : []),
    ];
    return unsupported(
      "OFFICE_DOCUMENT",
      officeMime(path),
      reasons,
      sample,
      options.note,
      "an office document handler",
    );
  });
}

function officeMime(path: string): string {
  if (path.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (path.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (path.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  return "application/vnd.openxmlformats-officedocument";
}
