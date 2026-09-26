import type { Digest } from "../contract/digest.ts";
import type { ContentPart, FileInfo, ReadObservation } from "../contract/result.ts";

const ENCODER = new TextEncoder();

export interface ObservationInput {
  readonly file: FileInfo;
  readonly contentId: string | null;
  /** What the model saw: the view text, or the parts of a media outcome. */
  readonly view: string | readonly ContentPart[];
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
  const viewId =
    typeof input.view === "string" ? digest.hash(input.view) : partsId(digest, input.view);
  return {
    id: digest.hash(JSON.stringify([statId, input.contentId, viewId])),
    statId,
    contentId: input.contentId,
    viewId,
    observedAt: input.observedAt,
    wholeFileVisible: input.wholeFileVisible,
  };
}

/** One hash over every part. Each part starts with its type and length, so parts cannot run together. */
function partsId(digest: Digest, parts: readonly ContentPart[]): string {
  const stream = digest.create();
  for (const part of parts) {
    if (part.type === "text") {
      const bytes = ENCODER.encode(part.text);
      stream.update(ENCODER.encode(`text:${bytes.byteLength}:`));
      stream.update(bytes);
    } else {
      stream.update(ENCODER.encode(`media:${part.mediaType}:${part.data.byteLength}:`));
      stream.update(part.data);
    }
  }
  return stream.digest();
}
