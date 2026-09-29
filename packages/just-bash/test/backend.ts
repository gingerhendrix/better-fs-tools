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
