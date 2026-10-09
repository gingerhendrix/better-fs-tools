import type { Classifier, DefaultClassifierOptions, NoteOverride } from "../contract/classify.ts";
import { binaryClassifier } from "./binary.ts";
import { imageClassifier } from "./image.ts";
import { officeClassifier } from "./office.ts";
import { pdfClassifier } from "./pdf.ts";
import { utf8Classifier } from "./utf8.ts";

export { binaryClassifier } from "./binary.ts";
export { extensionClassifier } from "./extension.ts";
export type { ExtensionClassifierOptions } from "./extension.ts";
export { imageClassifier } from "./image.ts";
export { notebookClassifier } from "./notebook.ts";
export { officeClassifier } from "./office.ts";
export { pdfClassifier } from "./pdf.ts";
export { utf8Classifier } from "./utf8.ts";

/**
 * The built-in chain in evaluation order: image, pdf, office, binary, utf8.
 * The first classifier with an opinion wins. utf8Classifier runs last and is
 * the one that returns text. A notebook is JSON text here. Put
 * notebookClassifier() before the chain to refuse or convert notebooks.
 */
export function defaultClassifiers(options: DefaultClassifierOptions = {}): Classifier[] {
  const notes = options.notes ?? {};
  return [
    imageClassifier(withNote(notes.IMAGE)),
    pdfClassifier(withNote(notes.PDF)),
    officeClassifier(withNote(notes.OFFICE_DOCUMENT)),
    binaryClassifier(withNote(notes.BINARY)),
    utf8Classifier(withNote(notes.UNKNOWN_ENCODING)),
  ];
}

function withNote(note: NoteOverride | undefined): { note?: NoteOverride } {
  return note === undefined ? {} : { note };
}
