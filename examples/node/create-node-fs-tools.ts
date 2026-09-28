import { createNodeFsTools } from "@better-fs-tools/node";
import { textOf } from "@better-fs-tools/read";
import { protectPaths } from "@better-fs-tools/write";

// read, edit, write, and apply_patch over one nodeFileSystem rooted at
// process.cwd(), with one read store, one SHA-256 digest, and one lock manager.
const tools = createNodeFsTools({
  edit: { authorize: protectPaths() },
  write: { authorize: protectPaths() },
  applyPatch: { authorize: protectPaths() },
});

export async function bump(path: string): Promise<string> {
  await tools.read({ path });
  const result = await tools.edit({ path, edits: [{ oldText: "a = 1", newText: "a = 2" }] });
  return textOf(result);
}

// A shell tool changed the file: the next edit must read it first.
export async function afterShell(path: string): Promise<boolean> {
  const outcome = await tools.invalidate(path);
  // ok: false means the stat or the store failed, and a record may still be there.
  return outcome.ok;
}
