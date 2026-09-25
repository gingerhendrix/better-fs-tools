import type { Classifier, NoteOverride } from "../contract/classify.ts";
import { classifier, unsupported } from "./shared.ts";

/** Jupyter JSON: an object with nbformat and a cells array, plus an .ipynb name or metadata. */
export function notebookClassifier(options: { note?: NoteOverride } = {}): Classifier {
  return classifier("notebook", (sample) => {
    const text = new TextDecoder("utf-8").decode(sample.bytes.subarray(0, 8_192));
    const evidence =
      /^\s*\{/u.test(text) && /"nbformat"\s*:/u.test(text) && /"cells"\s*:\s*\[/u.test(text);
    if (!evidence) return null;
    if (!sample.path.toLowerCase().endsWith(".ipynb") && !/"metadata"\s*:/u.test(text)) {
      return null;
    }
    return unsupported(
      "NOTEBOOK",
      "application/x-ipynb+json",
      ["notebook-json-evidence"],
      sample,
      options.note,
      "a notebook handler",
    );
  });
}
