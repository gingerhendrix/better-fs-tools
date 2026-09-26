import {
  defaultSignature,
  lineRangeSignature,
  renamedSignature,
} from "@better-fs-tools/read/signature";

// The default schema, with your own descriptions.
export const documented = defaultSignature({
  description: "Read a file in the repository.",
  describe: { path: "Path relative to the repository root." },
});

// The same range model with other names.
export const renamed = renamedSignature({
  name: "read_file",
  names: { path: "file_path", offset: "start", limit: "max_lines" },
});

// Inclusive start_line and end_line in place of offset and limit.
export const lineRange = lineRangeSignature({
  name: "read_file",
  names: { path: "file_path", start: "start_line", end: "end_line" },
});
