import type { ReadAuthorizer } from "../contract/extensions.ts";
import type { ReadNote } from "../contract/result.ts";
import { stepFailure } from "../core/extension-error.ts";

/**
 * Runs authorizers left to right. The first deny wins, with that step's note.
 * Allow notes from every step are kept in order. An empty chain allows. A step
 * that throws fails the read with EXTENSION_FAILED, naming the step's id.
 */
export function readAuthorizers<THost = unknown>(
  ...steps: readonly ReadAuthorizer<NoInfer<THost>>[]
): ReadAuthorizer<THost> {
  for (const step of steps) {
    if (step === null || typeof step !== "object" || typeof step.authorize !== "function") {
      throw new TypeError("readAuthorizers takes authorizers");
    }
  }
  const chain = Object.freeze([...steps]);
  return Object.freeze({
    id: chain.length === 0 ? "allow" : chain.map((step) => step.id).join("+"),
    async authorize(target, ctx) {
      const notes: ReadNote[] = [];
      for (const step of chain) {
        let decision;
        try {
          decision = await step.authorize(target, ctx);
          if (!decision.allow) return decision;
        } catch (error) {
          throw stepFailure(step, error);
        }
        if (decision.notes !== undefined) notes.push(...decision.notes);
      }
      return notes.length === 0 ? { allow: true } : { allow: true, notes };
    },
  } satisfies ReadAuthorizer<THost>);
}
