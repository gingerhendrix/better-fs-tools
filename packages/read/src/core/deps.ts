import type { FileSystem } from "@better-fs-tools/fs";

import { defaultClassifiers } from "../classifiers/index.ts";
import type { Dependencies, ReadToolDeps } from "../contract/deps.ts";
import { lineNumberFormatter } from "../formatters/index.ts";
import { isRecord } from "./input.ts";
import { resolveLimits } from "./limits.ts";
import { resolveMessages } from "./messages.ts";

const KNOWN: ReadonlySet<string> = new Set([
  "fs",
  "limits",
  "messages",
  "classifiers",
  "digest",
  "clock",
  "formatter",
]);

/**
 * Validates and resolves dependencies once, synchronously. `limits` and
 * `messages` merge over their defaults key by key. Every other dependency
 * replaces its default. The core has no filesystem default: `fs` is required.
 */
export function resolveDependencies<THost>(deps: ReadToolDeps<THost>): Dependencies<THost> {
  if (!isRecord(deps)) throw new TypeError("read tool dependencies must be an object");
  for (const key of Object.keys(deps)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown read tool dependency: ${key}`);
  }

  const { fs } = deps;
  if (typeof fs !== "function" && !isFileSystem(fs)) {
    throw new TypeError("fs must be a FileSystem or a function that returns one");
  }
  const classifiers = deps.classifiers ?? defaultClassifiers();
  if (!Array.isArray(classifiers) || classifiers.length === 0) {
    throw new TypeError("classifiers must be a non-empty array");
  }
  const formatter = deps.formatter ?? lineNumberFormatter();
  if (!isRecord(formatter) || typeof formatter.format !== "function") {
    throw new TypeError("formatter must have a format function");
  }
  const clock = deps.clock ?? (() => new Date());
  if (typeof clock !== "function") throw new TypeError("clock must be a function");

  return Object.freeze({
    fs,
    limits: resolveLimits(deps.limits),
    messages: resolveMessages(deps.messages),
    classifiers: Object.freeze([...classifiers]),
    digest: deps.digest ?? null,
    clock,
    formatter,
  });
}

export function isFileSystem(value: unknown): value is FileSystem {
  return isRecord(value) && typeof value.open === "function";
}
