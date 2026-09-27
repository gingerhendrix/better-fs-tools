import type { AccessTarget, ToolHookContext } from "../contract/base.ts";
import type { AuthorizeDecision } from "../contract/extensions.ts";
import type { JsonObject } from "../contract/json.ts";
import type { ReadInput } from "../contract/input.ts";

export const ALLOW: AuthorizeDecision = Object.freeze({ allow: true });

/**
 * A denial with the catalog's `denied` text, so host wording applies. Takes
 * the tool-neutral context, so every tool's authorizer can use it. The result
 * fits both AuthorizeDecision and AccessDecision.
 */
export function deny(
  ctx: ToolHookContext<unknown>,
  target: AccessTarget,
  detail: string,
  extra: { readonly data?: JsonObject; readonly retry?: ReadInput } = {},
): AuthorizeDecision {
  return {
    allow: false,
    note: {
      code: "denied",
      severity: "warning",
      message: ctx.messages.denied({ path: target.requestedPath, detail }),
      ...extra,
    },
  };
}
