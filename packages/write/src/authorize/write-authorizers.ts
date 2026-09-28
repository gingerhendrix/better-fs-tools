import type { Note } from "@better-fs-tools/read";

import type { WriteAuthorizer } from "../contract/extensions.ts";
import { stepFailure } from "../core/extension-error.ts";

/**
 * Left to right. First deny wins, with that step's note. Allow notes from
 * every step are kept, in order. The first `content` wins, and later steps
 * still see the original target. No steps allows. A step that throws, or
 * returns something that is not a decision, is named by its id in
 * EXTENSION_FAILED. A read ToolAuthorizer such as denyPaths is a valid step.
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
