import { AbortStop } from "./abort.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import type { MutationScope } from "./scope.ts";

export async function acquireLocks<THost>(
  scope: MutationScope<THost>,
  keys: readonly string[],
  display: readonly string[],
): Promise<() => void> {
  scope.enter("lock");
  scope.checkAbort();
  const { locks } = scope.deps;
  const sorted = [...new Set(keys)].sort();
  const { signal } = scope;
  const started: Promise<unknown>[] = [];
  let outcome: unknown;
  try {
    outcome = await scope.race(() => {
      const pending = locks.acquire(sorted, signal === undefined ? {} : { signal });
      started.push(Promise.resolve(pending));
      return pending;
    });
  } catch (error) {
    if (error instanceof AbortStop) {
      for (const pending of started) void pending.then(releaseLockGrantedAfterAbort, () => {});
      throw error;
    }
    throw scope.extensionFailure("locks", extensionId(locks, error));
  }
  if (!isRecord(outcome)) throw scope.extensionFailure("locks", extensionId(locks));
  if (outcome.ok === true && typeof outcome.release === "function") {
    const release = outcome.release as () => void;
    return () => {
      try {
        release.call(outcome);
      } catch {
        // A lock manager that fails to release cannot fail the call.
      }
    };
  }
  if (outcome.ok === false && outcome.reason === "aborted") throw new AbortStop();
  if (outcome.ok === false && outcome.reason === "timeout") {
    throw scope.stop("LOCK_TIMEOUT", scope.deps.messages.lockTimeout({ paths: display }));
  }
  throw scope.extensionFailure("locks", extensionId(locks));
}

function releaseLockGrantedAfterAbort(outcome: unknown): void {
  if (isRecord(outcome) && outcome.ok === true && typeof outcome.release === "function") {
    try {
      (outcome.release as () => void).call(outcome);
    } catch {
      // Nothing waits for this release.
    }
  }
}
