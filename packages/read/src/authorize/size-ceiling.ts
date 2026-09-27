import type { Authorizer } from "../contract/extensions.ts";
import { ALLOW, deny } from "./shared.ts";

/**
 * Denies a "read" when size > maxBytes. With unrangedOnly, only when
 * request.ranged is false, and the note offers a ranged retry. An unknown
 * size is allowed. Never denies a "list".
 */
export function sizeCeiling(options: {
  maxBytes: number;
  unrangedOnly?: boolean;
}): Authorizer<unknown> {
  const { maxBytes, unrangedOnly = false } = options ?? {};
  if (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("sizeCeiling maxBytes must be a non-negative safe integer");
  }
  if (typeof unrangedOnly !== "boolean") {
    throw new TypeError("sizeCeiling unrangedOnly must be a boolean");
  }
  return Object.freeze({
    id: "size-ceiling",
    authorize(target, ctx) {
      if (target.action !== "read" || target.size === null || target.size <= maxBytes) {
        return ALLOW;
      }
      const data = { size: target.size, maxBytes };
      if (!unrangedOnly) {
        return deny(ctx, target, `${target.size} bytes is over the ${maxBytes}-byte ceiling`, {
          data,
        });
      }
      if (ctx.request.ranged) return ALLOW;
      const { path, offset, limit } = ctx.request;
      const retry = { path, offset, limit };
      return deny(
        ctx,
        target,
        `${target.size} bytes is over the ${maxBytes}-byte ceiling for a whole-file read; a ranged read such as ${ctx.messages.retry(retry)} is allowed`,
        { data, retry },
      );
    },
  } satisfies Authorizer<unknown>);
}
