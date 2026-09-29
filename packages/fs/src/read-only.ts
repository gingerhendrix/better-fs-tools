import type { FileSystem } from "./contract.ts";

/**
 * What `readOnlyFileSystem(fs)` keeps from `fs`: every member that is not a
 * function, except `writeCapabilities`, and `open` and `list`. So the root
 * settings (`cwd`, `allowedRoots`, `denyRoots`, `symlinks`, `identity`,
 * `maxBufferedBytes`) of an adapter stay on the view.
 */
export type ReadOnlyFileSystem<T extends FileSystem = FileSystem> = FileSystem & {
  readonly [
    K in keyof T as K extends "writeCapabilities"
      ? never
      : T[K] extends (...args: never[]) => unknown
        ? never
        : K
  ]: T[K];
};

/**
 * A view of `fs` with only the read members: every value member but
 * `writeCapabilities`, `open`, and `list` when `fs` has it. The write methods
 * are dropped, not refused, so the result is not a `WritableFileSystem`: a
 * write tool refuses it when it is built, and a read tool works as before.
 * Policy stays in `fs`.
 */
export function readOnlyFileSystem<T extends FileSystem>(fs: T): ReadOnlyFileSystem<T> {
  if (fs === null || typeof fs !== "object" || typeof fs.open !== "function") {
    throw new TypeError("readOnlyFileSystem needs a FileSystem");
  }
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(fs)) {
    const value: unknown = (fs as Record<string, unknown>)[key];
    if (key !== "writeCapabilities" && typeof value !== "function") values[key] = value;
  }
  const list = fs.list;
  return Object.freeze({
    ...values,
    id: fs.id,
    capabilities: fs.capabilities,
    paths: fs.paths,
    open: fs.open.bind(fs),
    ...(typeof list === "function" ? { list: list.bind(fs) } : {}),
  }) as unknown as ReadOnlyFileSystem<T>;
}
