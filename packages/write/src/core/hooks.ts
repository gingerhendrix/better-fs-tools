import type { MutatedFile, OpenFile, WritableFileSystem } from "@better-fs-tools/fs";
import type { Note } from "@better-fs-tools/read";

import type { AfterWriteContext, WriteHook } from "../contract/extensions.ts";
import type { FileChange } from "../contract/result.ts";
import { hashBytes } from "./bytes.ts";
import { isRecord } from "./input.ts";
import { readCapped } from "./load.ts";
import { isNoteList } from "./outcomes.ts";
import type { Planned } from "./planned.ts";
import type { MutationScope } from "./scope.ts";

/** One committed file. Hooks may replace `change`. Record reads the final state. */
export interface Committed {
  readonly planned: Planned;
  change: FileChange;
  identity: string | null;
  /** false when a hook rewrote the file and the core could not read it back. Record then deletes the key. */
  known: boolean;
  /** A hook rewrote the file. The model has not seen its bytes. */
  rewritten: boolean;
}

export function committedFile<THost>(
  scope: MutationScope<THost>,
  planned: Planned,
  change: FileChange,
  file: MutatedFile,
): Committed {
  const identity = scope.fileSystem().capabilities.identity ? file.identity : null;
  return { planned, change, identity, known: true, rewritten: false };
}

/**
 * Runs every hook in order for each committed file, after the whole commit.
 * The file is committed, so a hook that throws or returns a malformed result
 * adds a hook-failed warning and the status stays ok. When a hook says it
 * rewrote the file, the core reads it back and hashes it once after the last
 * hook, updates `change.after`, and adds a hook-rewrote note for each such hook.
 */
export async function runWriteHooks<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  committed: readonly Committed[],
): Promise<void> {
  const { hooks, messages } = scope.deps;
  if (hooks.length === 0) return;
  scope.enter("hooks");
  const ctx: AfterWriteContext<THost> = Object.freeze({ ...scope.hookContext(), fs });
  for (const file of committed) {
    const path = file.change.path;
    const rewrote: string[] = [];
    for (const hook of hooks) {
      const result = await runHook(hook, file.change, ctx);
      if (result === null) {
        scope.notes.push({
          code: "hook-failed",
          severity: "warning",
          message: messages.hookFailed({ hook: hook.id, path }),
          data: { hook: hook.id },
        });
        continue;
      }
      scope.notes.push(...result.notes);
      if (result.rewrote) rewrote.push(hook.id);
    }
    if (rewrote.length === 0) continue;
    file.rewritten = true;
    await rehash(scope, fs, file);
    for (const hook of rewrote) {
      scope.notes.push({
        code: "hook-rewrote",
        severity: "warning",
        message: messages.hookRewrote({ hook, path }),
        data: { hook },
      });
    }
  }
}

/** The hook's notes and rewrote flag, or null for a throw or a malformed result. */
async function runHook<THost>(
  hook: WriteHook<THost>,
  change: FileChange,
  ctx: AfterWriteContext<THost>,
): Promise<{ readonly notes: readonly Note[]; readonly rewrote: boolean } | null> {
  let result: unknown;
  try {
    result = await hook.afterWrite(change, ctx);
  } catch {
    return null;
  }
  if (!isRecord(result)) return null;
  const { notes, rewrote } = result;
  if (notes !== undefined && !isNoteList(notes)) return null;
  if (rewrote !== undefined && typeof rewrote !== "boolean") return null;
  return { notes: notes ?? [], rewrote: rewrote === true };
}

/** Reads the file back after a hook rewrote it. On any failure the record stage deletes the key. */
async function rehash<THost>(
  scope: MutationScope<THost>,
  fs: WritableFileSystem,
  file: Committed,
): Promise<void> {
  const { digest, limits } = scope.deps;
  const { resolvedPath, requestedPath } = file.change;
  let handle: OpenFile | null = null;
  try {
    const opened = await fs.open(resolvedPath, {});
    if (!opened.ok) throw new Error(opened.error.reason);
    handle = opened.file;
    const bytes = await readCapped(scope, handle, limits.maxFileBytes, requestedPath, () => {
      return new Error("too large");
    });
    const { info } = handle;
    file.identity = fs.capabilities.identity ? info.identity : null;
    file.change = {
      ...file.change,
      after: {
        contentId: digest === null ? null : hashBytes(digest, bytes),
        version: info.version ?? null,
        bytes: bytes.byteLength,
      },
    };
  } catch {
    file.known = false;
    file.change = { ...file.change, after: { contentId: null, version: null, bytes: 0 } };
  } finally {
    await handle?.close().catch(() => {});
  }
}
