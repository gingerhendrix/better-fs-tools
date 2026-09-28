import type { WritableFileSystem } from "@better-fs-tools/fs";
import type { ReadStateStore } from "@better-fs-tools/read";

import { isStateStore, isWritable } from "../core/deps.ts";

/**
 * Deletes the record for a path, so the next edit or write needs a read. For
 * a shell tool that may have written the file. Runs fs.stat, then deletes
 * the record under the stat's resolved path. A stat failure deletes nothing.
 * Never throws.
 */
export function createInvalidator(deps: {
  readonly fs: WritableFileSystem;
  readonly state: ReadStateStore;
}): (path: string) => Promise<void> {
  if (deps === null || typeof deps !== "object") {
    throw new TypeError("createInvalidator takes { fs, state }");
  }
  const { fs, state } = deps;
  if (!isWritable(fs)) throw new TypeError("fs must be a WritableFileSystem");
  if (!isStateStore(state)) throw new TypeError("state must be a read state store");
  return async (path: string): Promise<void> => {
    try {
      const outcome = await fs.stat(path, {});
      if (!outcome.ok) return;
      await state.delete(outcome.stat.resolvedPath);
    } catch {
      // Invalidation is best effort: a failure leaves the record as it was.
    }
  };
}
