import type { FileSystem } from "@better-fs-tools/fs";

import { defaultClassifiers } from "../classifiers/index.ts";
import type { Dependencies, ReadToolDeps } from "../contract/deps.ts";
import type { Converter } from "../contract/extensions.ts";
import type { ReadStateStore } from "../contract/state.ts";
import { lineNumberFormatter } from "../formatters/index.ts";
import { defaultSuggest } from "../suggest/index.ts";
import { isRecord } from "./input.ts";
import { resolveLimits } from "./limits.ts";
import { resolveMessages } from "./messages.ts";

const KNOWN: ReadonlySet<string> = new Set([
  "fs",
  "limits",
  "messages",
  "classifiers",
  "resolve",
  "suggest",
  "authorize",
  "converters",
  "state",
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
  const resolve = deps.resolve ?? null;
  if (resolve !== null && (!isRecord(resolve) || typeof resolve.resolve !== "function")) {
    throw new TypeError("resolve must be a path resolver or null");
  }
  const suggest = deps.suggest === undefined ? defaultSuggest() : deps.suggest;
  if (suggest !== null && typeof suggest !== "function") {
    throw new TypeError("suggest must be a function or null");
  }
  const authorize = deps.authorize ?? null;
  if (authorize !== null && (!isRecord(authorize) || typeof authorize.authorize !== "function")) {
    throw new TypeError("authorize must be an authorizer or null");
  }
  const converters = deps.converters === undefined ? [] : deps.converters;
  if (!Array.isArray(converters) || !converters.every(isConverter)) {
    throw new TypeError("converters must be an array of file and directory converters");
  }
  const clock = deps.clock ?? (() => new Date());
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const state = deps.state ?? null;
  if (state !== null && typeof state !== "function" && !isStateStore(state)) {
    throw new TypeError("state must be a store, a function that returns one, or null");
  }

  return Object.freeze({
    fs,
    limits: resolveLimits(deps.limits),
    messages: resolveMessages(deps.messages),
    classifiers: Object.freeze([...classifiers]),
    resolve,
    suggest,
    authorize,
    converters: Object.freeze([...converters]),
    state,
    digest: deps.digest ?? null,
    clock,
    formatter,
  });
}

export function isFileSystem(value: unknown): value is FileSystem {
  return isRecord(value) && typeof value.open === "function";
}

function isConverter(value: unknown): value is Converter<unknown> {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.convert !== "function") {
    return false;
  }
  if (value.target === "directory") return true;
  return value.target === "file" && typeof value.accepts === "function";
}

export function isStateStore(value: unknown): value is ReadStateStore {
  return (
    isRecord(value) &&
    typeof value.get === "function" &&
    typeof value.put === "function" &&
    typeof value.delete === "function"
  );
}
