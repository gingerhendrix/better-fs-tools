/** Reads a converter source to the end. The core caps it at limits.maxConvertBytes. */
export async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** True when the match is an unsupported classification with this code. */
export function hasCode(classification: { kind: string; code?: string }, code: string): boolean {
  return classification.kind === "unsupported" && classification.code === code;
}
