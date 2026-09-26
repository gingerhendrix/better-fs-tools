import { createNodeReadTool } from "@better-fs-tools/node";
import { defaultClassifiers, extensionClassifier } from "@better-fs-tools/read";

export const read = createNodeReadTool({
  // A list dependency replaces the default. Include the default to add to it.
  classifiers: [
    extensionClassifier({ unsupported: { ".parquet": { code: "BINARY" } } }),
    ...defaultClassifiers(),
  ],
  // limits and messages merge over their defaults key by key.
  limits: { maxLines: 500 },
  messages: { notFound: ({ request }) => `No file at ${request.path}.` },
});
