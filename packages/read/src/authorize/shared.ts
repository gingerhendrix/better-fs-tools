import type { AccessTarget, ToolHookContext } from "../contract/base.ts";
import type { ReadAuthorizeDecision } from "../contract/extensions.ts";
import type { JsonObject } from "../contract/json.ts";
import type { ReadInput } from "../contract/input.ts";

export const ALLOW: ReadAuthorizeDecision = Object.freeze({ allow: true });

export function deny(
  ctx: ToolHookContext<unknown>,
  target: AccessTarget,
  detail: string,
  extra: { readonly data?: JsonObject; readonly retry?: ReadInput } = {},
): ReadAuthorizeDecision {
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
