import type { Note } from "@better-fs-tools/read";

import type { WriteAuthorizer } from "../contract/extensions.ts";
import { stepFailure } from "../core/extension-error.ts";

/**
 * Runs authorizers left to right. The first denial wins. Allow notes from
 * every step are kept, and the first replacement `content` wins. No steps
 * allows everything. A step that throws or returns an invalid decision fails
 * the call with EXTENSION_FAILED. A read authorizer such as denyPaths also
 * works as a step.
 */
export function writeAuthorizers<THost = unknown>(
  ...steps: readonly WriteAuthorizer<NoInfer<THost>>[]
): WriteAuthorizer<THost> {
  for (const step of steps) {
    if (step === null || typeof step !== "object" || typeof step.authorize !== "function") {
      throw new TypeError("writeAuthorizers takes authorizers");
    }
  }
  const chain = Object.freeze([...steps]);
  return Object.freeze({
    id: chain.length === 0 ? "allow" : chain.map((step) => step.id).join("+"),
    async authorize(target, ctx) {
      const notes: Note[] = [];
      let content: string | undefined;
      for (const step of chain) {
        let decision;
        try {
          decision = await step.authorize(target, ctx);
          if (decision === null || typeof decision !== "object") {
            throw new TypeError("not a decision");
          }
          if (decision.allow === false) return decision;
          if (decision.allow !== true) throw new TypeError("not a decision");
        } catch (error) {
          throw stepFailure(step, error);
        }
        if (decision.notes !== undefined) notes.push(...decision.notes);
        if (content === undefined && decision.content !== undefined) content = decision.content;
      }
      return {
        allow: true,
        ...(notes.length === 0 ? {} : { notes }),
        ...(content === undefined ? {} : { content }),
      };
    },
  } satisfies WriteAuthorizer<THost>);
}
