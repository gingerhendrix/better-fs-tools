import { nodeFileSystem } from "@better-fs-tools/node";
import {
  createReadTool,
  defaultClassifiers,
  directoryListing,
  imageConverter,
  notebookClassifier,
  notebookConverter,
  textConverter,
} from "@better-fs-tools/read";

// Your own PDF extraction, for example a pdftotext process that reads stdin.
declare function pdfToText(source: AsyncIterable<Uint8Array>): AsyncIterable<string>;

export const read = createReadTool({
  fs: nodeFileSystem({ allowedRoots: [process.cwd()] }),
  // The default chain reads a notebook as JSON text. notebookClassifier()
  // marks it NOTEBOOK, so notebookConverter() can take it.
  classifiers: [notebookClassifier(), ...defaultClassifiers()],
  converters: [
    imageConverter(),
    notebookConverter({ outputs: false }),
    textConverter({
      id: "pdftotext",
      accepts: (match) =>
        match.classification.kind === "unsupported" && match.classification.code === "PDF",
      mimeType: "text/plain",
      run: (source) => pdfToText(source),
    }),
    directoryListing({ trailingSlash: true }),
  ],
});
