import type { FileSystem } from "./contract.ts";

/**
 * The result of `readOnlyFileSystem(fs)`: `open`, `list`, and every
 * non-function member of `fs` except `writeCapabilities`, so an adapter's
 * root settings stay visible.
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
 * A view of `fs` without its write methods. The result is not a
 * `WritableFileSystem`, so a write tool refuses it when it is built, and a
 * read tool works as before.
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
