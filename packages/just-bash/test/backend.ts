import type { IFileSystem } from "just-bash";

import { justBashFileSystem, justBashReadFileSystem } from "../src/index.ts";
import type { JustBashReadFileSystemOptions } from "../src/index.ts";

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

export function adapter(fs: IFileSystem, overrides: Partial<JustBashReadFileSystemOptions> = {}) {
  return justBashReadFileSystem(fs, {
    id: "test-just-bash",
    cwd: "/workspace",
    allowedRoots: ["/workspace"],
    maxBufferedBytes: 1_024,
    identity: "required",
    ...overrides,
  });
}

/** The writable adapter with the same test defaults. */
export function writable(fs: IFileSystem, overrides: Partial<JustBashReadFileSystemOptions> = {}) {
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
