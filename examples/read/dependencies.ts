import { nodeFileSystem } from "@better-fs-tools/node";
import { createReadTool, defaultClassifiers, extensionClassifier } from "@better-fs-tools/read";

export const read = createReadTool({
  fs: nodeFileSystem({ allowedRoots: [process.cwd()] }),
  // A list option replaces the default. Include the default to add to it.
  classifiers: [
    extensionClassifier({ unsupported: { ".parquet": { code: "BINARY" } } }),
    ...defaultClassifiers(),
  ],
  // limits and messages merge over their defaults key by key.
  limits: { maxLines: 500 },
  messages: { notFound: ({ request }) => `No file at ${request.path}.` },
});
