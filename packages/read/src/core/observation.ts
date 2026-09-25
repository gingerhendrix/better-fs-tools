import type { Digest } from "../contract/digest.ts";
import type { FileInfo, ReadObservation } from "../contract/result.ts";

export interface ObservationInput {
  readonly file: FileInfo;
  readonly contentId: string | null;
  readonly viewText: string;
  readonly observedAt: string;
  readonly wholeFileVisible: boolean;
}

/** null without a digest. */
export function buildObservation(
  digest: Digest | null,
  input: ObservationInput,
): ReadObservation | null {
  if (digest === null) return null;
  const statId = digest.hash(
    JSON.stringify({
      resolvedPath: input.file.resolvedPath,
      identity: input.file.identity,
      size: input.file.size,
      mtimeMs: input.file.mtimeMs,
    }),
  );
  const viewId = digest.hash(input.viewText);
  return {
    id: digest.hash(JSON.stringify([statId, input.contentId, viewId])),
    statId,
    contentId: input.contentId,
    viewId,
    observedAt: input.observedAt,
    wholeFileVisible: input.wholeFileVisible,
  };
}
