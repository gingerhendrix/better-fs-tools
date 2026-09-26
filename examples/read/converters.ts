import { createNodeReadTool } from "@better-fs-tools/node";
import {
  directoryListing,
  imageConverter,
  notebookConverter,
  textConverter,
} from "@better-fs-tools/read";

// Your own PDF extraction, for example a pdftotext process that reads stdin.
declare function pdfToText(source: AsyncIterable<Uint8Array>): AsyncIterable<string>;

export const read = createNodeReadTool({
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
