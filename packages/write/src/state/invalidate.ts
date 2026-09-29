import type { FileSystemError, WritableFileSystem } from "@better-fs-tools/fs";
import type { ReadStateStore } from "@better-fs-tools/read";

import { isStateStore, isWritable } from "../core/deps.ts";
import { messageOf } from "../core/outcomes.ts";

/**
 * What `invalidate(path)` did. `recorded` says whether a read record existed.
 * On failure the record, if any, stays.
 */
export type InvalidateOutcome =
  | { readonly ok: true; readonly resolvedPath: string; readonly recorded: boolean }
  | { readonly ok: false; readonly phase: "stat"; readonly error: FileSystemError }
  | { readonly ok: false; readonly phase: "state"; readonly detail: string };

export type Invalidate = (path: string) => Promise<InvalidateOutcome>;

/**
 * Deletes the read record for a path, so the next edit or write needs a fresh
 * read. Use it after a shell tool may have written the file. Never throws:
 * every failure is returned as an outcome.
 */
export function createInvalidator(deps: {
  readonly fs: WritableFileSystem;
  readonly state: ReadStateStore;
}): Invalidate {
  if (deps === null || typeof deps !== "object") {
    throw new TypeError("createInvalidator takes { fs, state }");
  }
  const { fs, state } = deps;
  if (!isWritable(fs)) throw new TypeError("fs must be a WritableFileSystem");
  if (!isStateStore(state)) throw new TypeError("state must be a read state store");
  return async (path: string): Promise<InvalidateOutcome> => {
    let resolvedPath: string;
    try {
      const outcome = await fs.stat(path, {});
      if (!outcome.ok) return { ok: false, phase: "stat", error: outcome.error };
      resolvedPath = outcome.stat.resolvedPath;
    } catch (error) {
      return { ok: false, phase: "stat", error: { reason: "io", detail: messageOf(error) } };
    }
    try {
      const recorded = (await state.get(resolvedPath)) !== null;
      await state.delete(resolvedPath);
      return { ok: true, resolvedPath, recorded };
    } catch (error) {
      return { ok: false, phase: "state", detail: messageOf(error) };
    }
  };
}
