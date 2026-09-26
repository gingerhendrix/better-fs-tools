import { memoryFileSystem } from "@better-fs-tools/fs";
import { createReadTool, defaultClassifiers, extensionClassifier } from "@better-fs-tools/read";

export const read = createReadTool({
  fs: memoryFileSystem(),
  classifiers: [
    extensionClassifier({
      unsupported: {
        ".sqlite": { code: "BINARY" },
        ".png": { code: "IMAGE", mimeType: "image/png" },
      },
      text: [".lock"],
    }),
    ...defaultClassifiers({ notes: { PDF: { message: "PDFs are not supported here." } } }),
  ],
});
