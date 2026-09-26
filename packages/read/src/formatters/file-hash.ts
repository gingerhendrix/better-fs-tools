import type { LineNumberFormatterOptions } from "./line-number.ts";

/**
 * "file-hash: <contentId>". Uses observation.contentId, the hash of the source
 * bytes. Returns null when it is unknown: no digest, a scan that stopped
 * before EOF, or an outcome with no observation.
 */
export function fileHashHeader(): NonNullable<LineNumberFormatterOptions["header"]> {
  return (outcome) => {
    if (outcome.status !== "ok" && outcome.status !== "media") return null;
    const contentId = outcome.observation?.contentId ?? null;
    return contentId === null ? null : `file-hash: ${contentId}`;
  };
}
