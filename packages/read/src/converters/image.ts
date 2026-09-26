import { posixPaths } from "@better-fs-tools/fs";

import type { FileConverter, HookContext } from "../contract/extensions.ts";
import { collect, hasCode } from "./shared.ts";

export interface ImageConverterOptions<THost = unknown> {
  /** Resize or re-encode before the image goes to the model. The media type stays the same. */
  transform?: (
    bytes: Uint8Array,
    mediaType: string,
    ctx: HookContext<THost>,
  ) => Promise<Uint8Array>;
}

/** Accepts classification code "IMAGE". Emits one media part. Output size is capped by limits.maxMediaBytes. */
export function imageConverter<THost = unknown>(
  options: ImageConverterOptions<THost> = {},
): FileConverter<THost> {
  const { transform } = options;
  if (transform !== undefined && typeof transform !== "function") {
    throw new TypeError("imageConverter transform must be a function");
  }
  return Object.freeze<FileConverter<THost>>({
    id: "image",
    target: "file",
    accepts: (match) => hasCode(match.classification, "IMAGE"),
    async convert(input, ctx) {
      const mediaType =
        input.classification.mimeType ?? input.info.mimeType ?? "application/octet-stream";
      const bytes = await collect(input.bytes());
      const data = transform === undefined ? bytes : await transform(bytes, mediaType, ctx);
      return {
        kind: "media",
        parts: [
          { type: "media", mediaType, data, name: posixPaths.basename(input.info.displayPath) },
        ],
      };
    },
  });
}
