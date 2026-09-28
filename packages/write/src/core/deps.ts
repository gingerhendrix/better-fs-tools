import { isWritableFileSystem } from "@better-fs-tools/fs";
import type { WritableFileSystem } from "@better-fs-tools/fs";
import { defaultClassifiers } from "@better-fs-tools/read";
import type { Digest, ReadStateStore } from "@better-fs-tools/read";

import { utf8Codec } from "../codecs/utf8.ts";
import type { Codec } from "../contract/codec.ts";
import type {
  EditDependencies,
  EditToolDeps,
  WriteDependencies,
  WriteToolDeps,
} from "../contract/deps.ts";
import type { Guard, WriteHook } from "../contract/extensions.ts";
import type { LockManager } from "../contract/locks.ts";
import type { Matcher } from "../contract/matcher.ts";
import { defaultPreconditions } from "../contract/preconditions.ts";
import type { PreconditionPolicy } from "../contract/preconditions.ts";
import { defaultWriteFormatter } from "../formatters/default.ts";
import { defaultGuards } from "../guards/index.ts";
import { memoryLocks } from "../locks/memory-locks.ts";
import { defaultEditMatchers } from "../matchers/index.ts";
import { isRecord } from "./input.ts";
import { resolveWriteLimits } from "./limits.ts";
import { resolveWriteMessages } from "./messages.ts";

const KNOWN: ReadonlySet<string> = new Set([
  "fs",
  "limits",
  "messages",
  "resolve",
  "authorize",
  "preconditions",
  "state",
  "digest",
  "clock",
  "locks",
  "classifiers",
  "codecs",
  "guards",
  "hooks",
  "formatter",
]);

/**
 * Validates and resolves the shared dependencies once, synchronously.
 * `limits`, `messages`, and `preconditions` merge over their defaults key by
 * key. Every other dependency replaces its default. `fs` is required. `tool`
 * names the tool in the TypeError texts.
 */
export function resolveWriteDependencies<THost>(
  deps: WriteToolDeps<THost>,
  tool: string,
): WriteDependencies<THost> {
  if (!isRecord(deps)) throw new TypeError(`${tool} tool dependencies must be an object`);
  for (const key of Object.keys(deps)) {
    if (!KNOWN.has(key)) throw new TypeError(`Unknown ${tool} tool dependency: ${key}`);
  }

  const { fs } = deps;
  if (typeof fs !== "function" && !isWritable(fs)) {
    throw new TypeError("fs must be a WritableFileSystem or a function that returns one");
  }
  const resolve = deps.resolve ?? null;
  if (resolve !== null && (!isRecord(resolve) || typeof resolve.resolve !== "function")) {
    throw new TypeError("resolve must be a path resolver or null");
  }
  const authorize = deps.authorize ?? null;
  if (authorize !== null && (!isRecord(authorize) || typeof authorize.authorize !== "function")) {
    throw new TypeError("authorize must be an authorizer or null");
  }
  const state = deps.state ?? null;
  if (state !== null && typeof state !== "function" && !isStateStore(state)) {
    throw new TypeError("state must be a store, a function that returns one, or null");
  }
  const digest = deps.digest ?? null;
  if (digest !== null && !isDigest(digest)) {
    throw new TypeError("digest must have an id, create, and hash, or be null");
  }
  if (state !== null && digest === null) {
    throw new TypeError("state needs a digest: records name the digest that made them");
  }
  const clock = deps.clock ?? (() => new Date());
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  const locks = deps.locks ?? memoryLocks();
  if (!isLockManager(locks)) throw new TypeError("locks must be a lock manager");
  const classifiers = deps.classifiers ?? defaultClassifiers();
  if (!Array.isArray(classifiers) || classifiers.length === 0) {
    throw new TypeError("classifiers must be a non-empty array");
  }
  const codecs = deps.codecs ?? [utf8Codec()];
  if (!Array.isArray(codecs) || codecs.length === 0 || !codecs.every(isCodec)) {
    throw new TypeError("codecs must be a non-empty array of codecs");
  }
  const guards = deps.guards ?? defaultGuards();
  if (!Array.isArray(guards) || !guards.every(isGuard)) {
    throw new TypeError("guards must be an array of guards with an id and check");
  }
  const hooks = deps.hooks ?? [];
  if (!Array.isArray(hooks) || !hooks.every(isHook)) {
    throw new TypeError("hooks must be an array of hooks with an id and afterWrite");
  }
  const formatter = deps.formatter ?? defaultWriteFormatter();
  if (!isRecord(formatter) || typeof formatter.format !== "function") {
    throw new TypeError("formatter must have a format function");
  }

  return Object.freeze({
    fs,
    limits: resolveWriteLimits(deps.limits),
    messages: resolveWriteMessages(deps.messages),
    resolve,
    authorize,
    preconditions: resolvePreconditions(deps.preconditions),
    state,
    digest,
    clock,
    locks,
    classifiers: Object.freeze([...classifiers]),
    codecs: Object.freeze([...codecs]),
    guards: Object.freeze([...guards]),
    hooks: Object.freeze([...hooks]),
    formatter,
  });
}

/** The shared dependencies plus `matchers`: ordered and non-empty. Default defaultEditMatchers(). */
export function resolveEditDependencies<THost>(deps: EditToolDeps<THost>): EditDependencies<THost> {
  if (!isRecord(deps)) throw new TypeError("edit tool dependencies must be an object");
  const { matchers = defaultEditMatchers(), ...shared } = deps;
  if (!Array.isArray(matchers) || matchers.length === 0 || !matchers.every(isMatcher)) {
    throw new TypeError("matchers must be a non-empty array of matchers");
  }
  return Object.freeze({
    ...resolveWriteDependencies(shared, "edit"),
    matchers: Object.freeze([...matchers]),
  });
}

const POLICY_VALUES: { readonly [K in keyof PreconditionPolicy]: readonly string[] } = {
  requireRead: ["existing", "off"],
  partialRead: ["edit-only", "always", "never"],
  onStale: ["rematch", "reject"],
};

/** Merges key by key. Throws TypeError on an unknown key or value. */
export function resolvePreconditions(
  overrides: Partial<PreconditionPolicy> = {},
): Readonly<PreconditionPolicy> {
  if (!isRecord(overrides)) throw new TypeError("preconditions must be an object");
  const resolved: Record<string, unknown> = { ...defaultPreconditions };
  for (const [key, value] of Object.entries(overrides)) {
    const allowed = POLICY_VALUES[key as keyof PreconditionPolicy] as readonly string[] | undefined;
    if (!Object.hasOwn(POLICY_VALUES, key) || allowed === undefined) {
      throw new TypeError(`Unknown precondition policy key: ${key}`);
    }
    if (value === undefined) continue;
    if (typeof value !== "string" || !allowed.includes(value)) {
      throw new TypeError(`preconditions.${key} must be one of ${allowed.join(", ")}`);
    }
    resolved[key] = value;
  }
  return Object.freeze(resolved as unknown as PreconditionPolicy);
}

export function isWritable(value: unknown): value is WritableFileSystem {
  return (
    isRecord(value) &&
    typeof value.open === "function" &&
    isWritableFileSystem(value as unknown as WritableFileSystem)
  );
}

export function isStateStore(value: unknown): value is ReadStateStore {
  return (
    isRecord(value) &&
    typeof value.get === "function" &&
    typeof value.put === "function" &&
    typeof value.delete === "function"
  );
}

function isDigest(value: unknown): value is Digest {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.create === "function" &&
    typeof value.hash === "function"
  );
}

function isLockManager(value: unknown): value is LockManager {
  return isRecord(value) && typeof value.id === "string" && typeof value.acquire === "function";
}

function isCodec(value: unknown): value is Codec {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.accepts === "function" &&
    typeof value.decode === "function" &&
    typeof value.encode === "function" &&
    isRecord(value.newFileStyle)
  );
}

function isMatcher(value: unknown): value is Matcher {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.fuzzy === "boolean" &&
    typeof value.describe === "string" &&
    typeof value.find === "function" &&
    (value.adapt === undefined || typeof value.adapt === "function")
  );
}

function isGuard(value: unknown): value is Guard<unknown> {
  return isRecord(value) && typeof value.id === "string" && typeof value.check === "function";
}

function isHook(value: unknown): value is WriteHook<unknown> {
  return isRecord(value) && typeof value.id === "string" && typeof value.afterWrite === "function";
}
