import type { LineNumberFormatterOptions } from "./line-number.ts";

/**
 * A "file-hash: <contentId>" header, where contentId is the hash of the source
 * bytes. Shows nothing when the hash is unknown: no digest, a scan that stopped
 * before EOF, or an outcome with no observation.
 */
export function fileHashHeader(): NonNullable<LineNumberFormatterOptions["header"]> {
  return (outcome) => {
    if (outcome.status !== "ok" && outcome.status !== "media") return null;
    const contentId = outcome.observation?.contentId ?? null;
    return contentId === null ? null : `file-hash: ${contentId}`;
  };
}
