import { defaultReadSignature } from "@better-fs-tools/read/signature";

// The default schema, with your own descriptions.
export const documented = defaultReadSignature({
  description: "Read a file in the repository.",
  describe: { path: "Path relative to the repository root." },
});

// The same range model with other names.
export const renamed = defaultReadSignature({
  name: "read_file",
  names: { path: "file_path", offset: "start", limit: "max_lines" },
});
