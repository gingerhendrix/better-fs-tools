import type { FileSystem } from "./contract.ts";

/**
 * A view of `fs` with only the read members: `id`, `capabilities`, `paths`,
 * `open`, and `list` when `fs` has it. The write methods are dropped, not
 * refused, so the result is not a `WritableFileSystem`: a write tool refuses
 * it when it is built, and a read tool works as before. Policy stays in `fs`.
 */
export function readOnlyFileSystem(fs: FileSystem): FileSystem {
  if (fs === null || typeof fs !== "object" || typeof fs.open !== "function") {
    throw new TypeError("readOnlyFileSystem needs a FileSystem");
  }
  const list = fs.list;
  return Object.freeze({
    id: fs.id,
    capabilities: fs.capabilities,
    paths: fs.paths,
    open: fs.open.bind(fs),
    ...(typeof list === "function" ? { list: list.bind(fs) } : {}),
  });
}
