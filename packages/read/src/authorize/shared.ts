import type { AuthorizeDecision, HookContext } from "../contract/extensions.ts";
import type { JsonObject } from "../contract/json.ts";
import type { ReadInput } from "../contract/input.ts";

export const ALLOW: AuthorizeDecision = Object.freeze({ allow: true });

/** A denial with the catalog's `denied` text, so host wording applies. */
export function deny(
  ctx: HookContext<unknown>,
  detail: string,
  extra: { readonly data?: JsonObject; readonly retry?: ReadInput } = {},
): AuthorizeDecision {
  return {
    allow: false,
    note: {
      code: "denied",
      severity: "warning",
      message: ctx.messages.denied({ request: ctx.request, detail }),
      ...extra,
    },
  };
}
