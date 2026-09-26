import { memoryFileSystem, runFileSystemConformance } from "@better-fs-tools/fs";

// Replace the memory filesystem with your own FileSystem.
const fs = memoryFileSystem({ files: { "/a.txt": "alpha\n" }, directories: ["/dir"] });

const report = await runFileSystemConformance(fs, {
  existingFile: { path: "/a.txt", bytes: new TextEncoder().encode("alpha\n") },
  missingPath: "/missing.txt",
  directoryPath: "/dir",
  listDirectory: "/",
});
console.log(report.passed); // true when the adapter keeps the contract
