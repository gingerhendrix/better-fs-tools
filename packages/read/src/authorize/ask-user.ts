import type {
  ReadAuthorizer,
  ReadAuthorizeTarget,
  ReadHookContext,
} from "../contract/extensions.ts";
import { ALLOW, deny } from "./shared.ts";

/**
 * Calls prompt for each "read". Anything but true, or a throw from prompt,
 * denies. A "list" is allowed without a prompt. There is no remember option
 * (G11): a host keeps answers through ctx.call.host. The core races the
 * prompt against the call's signal, so an abort ends the read even when the
 * prompt ignores it.
 */
export function askUser<THost>(
  prompt: (target: ReadAuthorizeTarget, ctx: ReadHookContext<THost>) => Promise<boolean>,
): ReadAuthorizer<THost> {
  if (typeof prompt !== "function") throw new TypeError("askUser takes a prompt function");
  return Object.freeze({
    id: "ask-user",
    async authorize(target, ctx) {
      if (target.action !== "read") return ALLOW;
      let approved: unknown = false;
      try {
        approved = await prompt(target, ctx);
      } catch {
        approved = false;
      }
      return approved === true ? ALLOW : deny(ctx, target, "the user did not approve the read");
    },
  } satisfies ReadAuthorizer<THost>);
}
