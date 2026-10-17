import { nodeFileSystem } from "@better-fs-tools/node";
import {
  createReadTool,
  eofFooter,
  fileHashHeader,
  hashlineGutter,
  lineNumberFormatter,
} from "@better-fs-tools/read";

export const read = createReadTool({
  fs: nodeFileSystem({ allowedRoots: [process.cwd()] }),
  formatter: lineNumberFormatter({
    gutter: hashlineGutter({ width: 2 }), // "12:a3|text"
    header: fileHashHeader(), // "file-hash: sha256:..."
    footer: eofFooter((n) => `(End of file - total ${n} lines)`),
    notes: (note) => (note.severity === "info" ? null : note),
  }),
});
