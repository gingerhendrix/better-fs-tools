import { homedir } from "node:os";
import { createNodeReadTool, nodeFileSystem } from "@better-fs-tools/node";
import { expandHome, pathResolvers, stripPrefixes, unicodeRepair } from "@better-fs-tools/read";

const cwd = process.cwd();
const home = homedir();

export const read = createNodeReadTool({
  fs: nodeFileSystem({ cwd, allowedRoots: [cwd, `${home}/.config/app`] }),
  resolve: pathResolvers(
    stripPrefixes(), // "file:///x" and "@src/x"
    expandHome({ home }), // "~" and "~/x"
    unicodeRepair(), // macOS U+202F screenshot names
  ),
});
