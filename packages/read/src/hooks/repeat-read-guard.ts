import type { ReadHook } from "../contract/extensions.ts";
import type { ReadRecord } from "../contract/state.ts";

export interface RepeatReadGuardOptions {
  /** The repeat-read note text. Default: names the path and when it was read. */
  message?: (previous: ReadRecord) => string;
}

/**
 * When previous has the same contentId (not null), offset, and limit, replaces
 * the view with an empty view and adds a "repeat-read" note. Does nothing when
 * the observation is null (no digest) or previous is null (no state). Needs
 * both a digest and a state store to fire. The core then marks the view as
 * modified, so the stored record says the whole file was not visible.
 */
export function repeatReadGuard(options: RepeatReadGuardOptions = {}): ReadHook<unknown> {
  const { message } = options ?? {};
  if (message !== undefined && typeof message !== "function") {
    throw new TypeError("repeatReadGuard message must be a function");
  }
  return Object.freeze<ReadHook<unknown>>({
    id: "repeat-read-guard",
    afterRead(outcome, ctx) {
      const { previous } = ctx;
      if (outcome.status !== "ok" || outcome.observation === null || previous === null) {
        return outcome;
      }
      const { contentId } = outcome.observation;
      const { request, view } = outcome;
      if (
        contentId === null ||
        previous.contentId !== contentId ||
        previous.request.offset !== request.offset ||
        previous.request.limit !== request.limit ||
        view.lines.length === 0
      ) {
        return outcome;
      }
      return {
        ...outcome,
        view: { ...view, lines: [], endLine: view.startLine - 1, bytes: 0, partial: true },
        notes: [
          ...outcome.notes,
          {
            code: "repeat-read",
            severity: "info",
            message:
              message === undefined
                ? `${request.path} has not changed since it was read with the same range at ${previous.observedAt}. That output is still current, so it is not repeated.`
                : message(previous),
            data: { observationId: previous.observationId, observedAt: previous.observedAt },
          },
        ],
      };
    },
  });
}
