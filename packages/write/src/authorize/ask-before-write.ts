import type { PlannedChange, WriteAuthorizer, WriteHookContext } from "../contract/extensions.ts";

type Answer = boolean | { readonly content: string };

/**
 * Asks `prompt` once for each call, with every planned change, before anything
 * is written. `true` allows. `{ content }` allows with the user's content
 * (edit and write only). `false`, a throw, or anything else denies.
 */
export function askBeforeWrite<THost>(
  prompt: (plan: readonly PlannedChange[], ctx: WriteHookContext<THost>) => Promise<Answer>,
): WriteAuthorizer<THost> {
  if (typeof prompt !== "function") throw new TypeError("askBeforeWrite takes a prompt function");
  const answers = new WeakMap<object, Promise<unknown>>();
  return Object.freeze({
    id: "ask-before-write",
    async authorize(target, ctx) {
      if (target.change === null) return { allow: true };
      let answer = answers.get(ctx.call);
      if (answer === undefined) {
        answer = ask(prompt, target.plan, ctx);
        answers.set(ctx.call, answer);
      }
      const value = await answer;
      if (value === true) return { allow: true };
      if (
        value !== null &&
        typeof value === "object" &&
        typeof (value as { content?: unknown }).content === "string"
      ) {
        return { allow: true, content: (value as { content: string }).content };
      }
      return {
        allow: false,
        note: {
          code: "denied",
          severity: "warning",
          message: ctx.messages.denied({
            path: target.requestedPath,
            detail: "the user did not approve the change",
          }),
        },
      };
    },
  } satisfies WriteAuthorizer<THost>);
}

async function ask<THost>(
  prompt: (plan: readonly PlannedChange[], ctx: WriteHookContext<THost>) => Promise<Answer>,
  plan: readonly PlannedChange[],
  ctx: WriteHookContext<THost>,
): Promise<unknown> {
  try {
    return await prompt(plan, ctx);
  } catch {
    return false;
  }
}
