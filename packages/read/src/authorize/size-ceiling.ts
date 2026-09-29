import type { ReadAuthorizer } from "../contract/extensions.ts";
import { ALLOW, deny } from "./shared.ts";

/**
 * Denies reading a file larger than `maxBytes`. With `unrangedOnly`, denies
 * only whole-file reads, and the note offers a ranged retry. Unknown sizes and
 * directory listings are allowed.
 */
export function sizeCeiling(options: {
  maxBytes: number;
  unrangedOnly?: boolean;
}): ReadAuthorizer<unknown> {
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
  } satisfies ReadAuthorizer<unknown>);
}
