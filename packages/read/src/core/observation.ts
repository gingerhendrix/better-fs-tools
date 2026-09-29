import type { Digest } from "../contract/digest.ts";
import type { ContentPart, FileInfo, ReadObservation } from "../contract/result.ts";

const ENCODER = new TextEncoder();

export interface ObservationInput {
  readonly file: FileInfo;
  readonly contentId: string | null;
  readonly view: string | readonly ContentPart[];
  readonly observedAt: string;
  readonly wholeFileVisible: boolean;
}

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
  const viewId = viewIdOf(digest, input.view);
  return {
    id: observationId(digest, statId, input.contentId, viewId),
    statId,
    contentId: input.contentId,
    viewId,
    observedAt: input.observedAt,
    wholeFileVisible: input.wholeFileVisible,
  };
}

export function withEditedView(
  digest: Digest,
  observation: ReadObservation,
  view: string | readonly ContentPart[],
): ReadObservation {
  const viewId = viewIdOf(digest, view);
  return {
    ...observation,
    id: observationId(digest, observation.statId, observation.contentId, viewId),
    viewId,
    wholeFileVisible: false,
  };
}

function viewIdOf(digest: Digest, view: string | readonly ContentPart[]): string {
  return typeof view === "string" ? digest.hash(view) : partsId(digest, view);
}

function observationId(
  digest: Digest,
  statId: string,
  contentId: string | null,
  viewId: string,
): string {
  return digest.hash(JSON.stringify([statId, contentId, viewId]));
}

function partsId(digest: Digest, parts: readonly ContentPart[]): string {
  const stream = digest.create();
  // Type and length prefixes stop different part lists from hashing the same.
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
