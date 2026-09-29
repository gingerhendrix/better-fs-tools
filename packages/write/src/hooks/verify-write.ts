import type { Digest, Note } from "@better-fs-tools/read";

import type { AfterWriteContext, WriteHook } from "../contract/extensions.ts";
import type { FileChange, FileVersion } from "../contract/result.ts";

/**
 * Reads each committed file back and checks it against what was written: by
 * hash when the call has a digest, else by size. A removed file must be gone.
 * A mismatch, or a file that cannot be read back, adds a warning note. Put it
 * before any hook that rewrites files, or it reports their rewrite as a
 * mismatch.
 */
export function verifyWrite(): WriteHook<unknown> {
  return Object.freeze<WriteHook<unknown>>({
    id: "verify-write",
    async afterWrite(change, ctx) {
      const outcome =
        change.after === null
          ? await checkRemoved(change, ctx)
          : await checkWritten(change, change.after, ctx);
      return outcome === "ok" ? {} : { notes: [warning(change, outcome)] };
    },
  });
}

type Outcome = "ok" | "mismatch" | "unreadable";

async function checkRemoved(change: FileChange, ctx: AfterWriteContext<unknown>): Promise<Outcome> {
  const outcome = await ctx.fs.stat(change.resolvedPath, {});
  if (!outcome.ok) return "unreadable";
  return outcome.stat.exists ? "mismatch" : "ok";
}

async function checkWritten(
  change: FileChange,
  after: FileVersion,
  ctx: AfterWriteContext<unknown>,
): Promise<Outcome> {
  const opened = await ctx.fs.open(change.resolvedPath, {});
  if (!opened.ok) return "unreadable";
  const handle = opened.file;
  const digest: Digest | null = after.contentId === null ? null : ctx.digest;
  const stream = digest?.create() ?? null;
  let size = 0;
  try {
    for await (const chunk of handle.bytes()) {
      size += chunk.byteLength;
      if (size > after.bytes) return "mismatch";
      stream?.update(chunk);
    }
  } catch {
    return "unreadable";
  } finally {
    await handle.close().catch(() => {});
  }
  if (size !== after.bytes) return "mismatch";
  return stream === null || stream.digest() === after.contentId ? "ok" : "mismatch";
}

function warning(change: FileChange, outcome: Exclude<Outcome, "ok">): Note {
  const path = change.path;
  const message =
    outcome === "unreadable"
      ? `${path} could not be read back to check the write. Read it before you change it again.`
      : change.after === null
        ? `${path} still exists after it was removed. Check the file before you continue.`
        : `${path} does not hold the bytes that were written. Read it again before you change it.`;
  return {
    code: outcome === "unreadable" ? "verify-failed" : "verify-mismatch",
    severity: "warning",
    message,
  };
}
