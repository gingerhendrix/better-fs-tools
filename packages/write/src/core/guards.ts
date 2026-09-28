import type { GuardContext, PlannedChange } from "../contract/extensions.ts";
import { AbortStop } from "./abort.ts";
import { extensionId } from "./extension-error.ts";
import { isRecord } from "./input.ts";
import { hostErrorNote, isNote, isNoteList } from "./outcomes.ts";
import type { MutationScope } from "./scope.ts";

/**
 * Runs every guard in order on every planned change. The first refusal gives
 * GUARD_REFUSED with the guard's message, and nothing is written. Allow notes
 * join the call's notes. A throw or a malformed decision gives
 * EXTENSION_FAILED with the guard's id.
 */
export async function runGuards<THost>(
  scope: MutationScope<THost>,
  changes: readonly PlannedChange[],
): Promise<void> {
  const { guards, classifiers } = scope.deps;
  if (guards.length === 0) return;
  scope.enter("guards");
  const ctx: GuardContext<THost> = Object.freeze({ ...scope.hookContext(), classifiers });
  for (const change of changes) {
    for (const guard of guards) {
      scope.checkAbort();
      let decision: unknown;
      try {
        decision = await scope.race(() => guard.check(change, ctx));
      } catch (error) {
        if (error instanceof AbortStop) throw error;
        throw scope.extensionFailure("guards", extensionId(guard, error));
      }
      const malformed = () => scope.extensionFailure("guards", extensionId(guard));
      if (!isRecord(decision)) throw malformed();
      if (decision.allow === true) {
        if (decision.notes === undefined) continue;
        if (!isNoteList(decision.notes)) throw malformed();
        scope.notes.push(...decision.notes);
        continue;
      }
      if (decision.allow !== false || !isNote(decision.note)) throw malformed();
      throw scope.stopWith(
        hostErrorNote("GUARD_REFUSED", decision.note, {
          guard: guard.id,
          path: change.displayPath,
        }),
      );
    }
  }
}
