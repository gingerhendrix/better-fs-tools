import type { Note, PathResolver } from "../contract/base.ts";
import { stepFailure } from "../core/extension-error.ts";

/**
 * Runs resolvers left to right, each on the previous path. The first not-found
 * stops the chain. All steps share one ctx.list budget, and the last note wins.
 * A step that throws fails the read with EXTENSION_FAILED, naming the step's id.
 */
export function pathResolvers<THost = unknown>(
  ...steps: readonly PathResolver<NoInfer<THost>>[]
): PathResolver<THost> {
  for (const step of steps) {
    if (step === null || typeof step !== "object" || typeof step.resolve !== "function") {
      throw new TypeError("pathResolvers takes path resolvers");
    }
  }
  const chain = Object.freeze([...steps]);
  return Object.freeze({
    id: chain.length === 0 ? "identity" : chain.map((step) => step.id).join("+"),
    async resolve(path, ctx) {
      let current = path;
      let note: Note | undefined;
      for (const step of chain) {
        let outcome;
        try {
          outcome = await step.resolve(current, ctx);
          note = outcome.note ?? note;
        } catch (error) {
          throw stepFailure(step, error);
        }
        if (outcome.kind === "not-found") {
          return note === undefined ? { kind: "not-found" } : { kind: "not-found", note };
        }
        current = outcome.path;
      }
      return note === undefined
        ? { kind: "path", path: current }
        : { kind: "path", path: current, note };
    },
  } satisfies PathResolver<THost>);
}
