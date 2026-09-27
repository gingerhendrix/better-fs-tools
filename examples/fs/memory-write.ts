import { memoryFileSystem } from "@better-fs-tools/fs";

const fs = memoryFileSystem({ files: { "/notes.txt": "one\n" } });
const stat = await fs.stat("/notes.txt", {});
if (stat.ok && stat.stat.exists) {
  const outcome = await fs.write("/notes.txt", new TextEncoder().encode("two\n"), {
    precondition: { kind: "version", version: stat.stat.version },
    createParents: false,
  });
  console.log(outcome.ok); // true
}
