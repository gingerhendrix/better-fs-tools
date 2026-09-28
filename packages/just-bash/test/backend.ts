import type { IFileSystem } from "just-bash";

import { justBashFileSystem } from "../src/index.ts";
import type { JustBashFileSystemOptions } from "../src/index.ts";

type Method =
  | "lstat"
  | "realpath"
  | "stat"
  | "readFileBuffer"
  | "readdir"
  | "writeFile"
  | "mkdir"
  | "rm"
  | "chmod"
  | "utimes";

/** The adapter with the test defaults. The read tests use it for reads only. */
export function adapter(fs: IFileSystem, overrides: Partial<JustBashFileSystemOptions> = {}) {
  return justBashFileSystem(fs, {
    id: "test-just-bash",
    cwd: "/workspace",
    allowedRoots: ["/workspace"],
    maxBufferedBytes: 1_024,
    identity: "required",
    ...overrides,
  });
}

/** The same adapter, named for the write tests. */
export function writable(fs: IFileSystem, overrides: Partial<JustBashFileSystemOptions> = {}) {
  return justBashFileSystem(fs, {
    id: "test-just-bash",
    cwd: "/workspace",
    allowedRoots: ["/workspace"],
    maxBufferedBytes: 1_024,
    identity: "required",
    ...overrides,
  });
}

/** Bind class methods to the real backend while changing selected calls. */
export function intercept(
  fs: IFileSystem,
  handlers: Partial<
    Record<Method, (original: (...args: never[]) => unknown, args: never[]) => unknown>
  >,
): IFileSystem {
  return new Proxy(fs, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      const original = value.bind(target) as (...args: never[]) => unknown;
      const handler =
        typeof property === "string" ? handlers[property as keyof typeof handlers] : undefined;
      return handler === undefined ? original : (...args: never[]) => handler(original, args);
    },
  });
}
