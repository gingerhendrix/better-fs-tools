import type { ClassificationSample, Classifier } from "@better-fs-tools/read";

import type { Guard, PlannedText } from "../contract/extensions.ts";
import { ALLOW, refuse } from "./shared.ts";

const ENCODER = new TextEncoder();
const BOM = Uint8Array.of(0xef, 0xbb, 0xbf);

/**
 * Refuses new content that the classifiers find is not text, such as NUL
 * bytes or an image. The default classifiers read a notebook as JSON text.
 * Add notebookClassifier() to the classifiers to refuse notebooks too.
 */
export function nonTextGuard(): Guard<unknown> {
  return Object.freeze<Guard<unknown>>({
    id: "non-text",
    check(change, ctx) {
      if (change.after === null) return ALLOW;
      const sample = sampleOf(change.after, ctx.limits.sampleBytes, change.displayPath);
      const found = unsupported(ctx.classifiers, sample);
      if (found === null) return ALLOW;
      return refuse(
        "non-text",
        `The new content for ${change.displayPath} is not plain text (${found.code}), so this tool will not write it. Send text content, or use a tool made for this kind of file.`,
        { code: found.code, classifier: found.classifier },
      );
    },
  });
}

function sampleOf(after: PlannedText, max: number, path: string): ClassificationSample {
  const unitsCoveringMaxBytes = max + 1;
  let head = after.text.slice(0, unitsCoveringMaxBytes);
  if (after.style.eol === "crlf") head = head.replaceAll("\n", "\r\n");
  const body = ENCODER.encode(head);
  const bytes = new Uint8Array((after.style.bom ? BOM.byteLength : 0) + body.byteLength);
  if (after.style.bom) bytes.set(BOM);
  bytes.set(body, bytes.byteLength - body.byteLength);
  return {
    bytes: bytes.subarray(0, max),
    complete: after.text.length <= max && bytes.byteLength <= max,
    path,
    mimeType: null,
  };
}

function unsupported(
  classifiers: readonly Classifier[],
  sample: ClassificationSample,
): { readonly code: string; readonly classifier: string } | null {
  for (const classifier of classifiers) {
    const decision = classifier.classify(sample);
    if (decision === null) continue;
    if (decision.kind === "text") return null;
    return { code: decision.code, classifier: classifier.id };
  }
  return null;
}
